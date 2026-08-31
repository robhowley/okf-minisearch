#![deny(clippy::all)]

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ops::Bound;

use chrono::{DateTime, Utc};
use napi::bindgen_prelude::Either;
use napi::{Error, Result as NapiResult, Status};
use napi_derive::napi;
use parking_lot::Mutex;
use tantivy::collector::{Count, TopDocs};
use tantivy::query::{
    BooleanQuery, BoostQuery, ConstScoreQuery, DisjunctionMaxQuery, FastFieldRangeQuery,
    FuzzyTermQuery, Occur, Query, TermQuery, TermSetQuery,
};
use tantivy::schema::{
    FAST, Field, INDEXED, IndexRecordOption, STORED, STRING, Schema, TantivyDocument,
    TextFieldIndexing, TextOptions, Value,
};
use tantivy::tokenizer::{LowerCaser, SimpleTokenizer, TextAnalyzer, TokenStream};
use tantivy::{DocAddress, Index, IndexReader, IndexWriter, ReloadPolicy, Score, Term};
use thiserror::Error as ThisError;

const TOKENIZER: &str = "okf";
const WRITER_HEAP_BYTES: usize = 15_000_000;
const FETCH_FLOOR: usize = 32;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
    pub path: String,
}

/// Search-independent output from the existing OKF parser/projector.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct PreparedSection {
    #[napi(js_name = "sectionId")]
    pub section_id: String,
    #[napi(js_name = "documentId")]
    pub document_id: String,
    pub conformance: String,
    pub title: String,
    pub path: String,
    #[napi(js_name = "type")]
    pub document_type: String,
    pub tags: Vec<String>,
    pub status: Option<String>,
    #[napi(js_name = "staleAfterEpoch")]
    pub stale_after_epoch: Option<f64>,
    #[napi(js_name = "stalenessClassified")]
    pub staleness_classified: bool,
    #[napi(js_name = "trustTier")]
    pub trust_tier: Option<String>,
    pub resource: String,
    #[napi(js_name = "headingPath")]
    pub heading_path: String,
    pub description: String,
    #[napi(js_name = "sourceText")]
    pub source_text: String,
    pub text: String,
    #[napi(js_name = "startLine")]
    pub start_line: u32,
    #[napi(js_name = "endLine")]
    pub end_line: u32,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct PreparedDocument {
    #[napi(js_name = "documentId")]
    pub document_id: String,
    pub path: String,
    #[napi(js_name = "type")]
    pub document_type: String,
    pub conformance: String,
    pub diagnostics: Vec<Diagnostic>,
    pub sections: Vec<PreparedSection>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct RemoveIdentity {
    #[napi(js_name = "documentId")]
    pub document_id: String,
    pub path: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SearchWhere {
    pub types: Option<Vec<String>>,
    #[napi(js_name = "tagsAny")]
    pub tags_any: Option<Vec<String>>,
    pub statuses: Option<Vec<String>>,
    #[napi(js_name = "trustTiers")]
    pub trust_tiers: Option<Vec<String>>,
    pub stale: Option<bool>,
    pub conformance: Option<Vec<String>>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SearchBoost {
    pub resource: Option<f64>,
    pub title: Option<f64>,
    pub heading: Option<f64>,
    pub description: Option<f64>,
    pub tags: Option<f64>,
    #[napi(js_name = "type")]
    pub document_type: Option<f64>,
    pub sources: Option<f64>,
    pub body: Option<f64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SearchOptions {
    pub limit: Option<f64>,
    #[napi(js_name = "where")]
    pub where_filter: Option<SearchWhere>,
    #[napi(js_name = "asOf")]
    pub as_of: Option<DateTime<Utc>>,
    #[napi(js_name = "match")]
    pub match_mode: Option<String>,
    pub fields: Option<Vec<String>>,
    pub boost: Option<SearchBoost>,
    pub fuzzy: Option<Either<bool, f64>>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SearchHit {
    #[napi(js_name = "documentId")]
    pub document_id: String,
    pub title: String,
    #[napi(js_name = "sectionId")]
    pub section_id: String,
    pub score: f64,
    pub conformance: String,
    #[napi(js_name = "matchedFields")]
    pub matched_fields: Vec<String>,
    #[napi(js_name = "headingPath")]
    pub heading_path: String,
    pub path: String,
    #[napi(js_name = "startLine")]
    pub start_line: u32,
    #[napi(js_name = "endLine")]
    pub end_line: u32,
    pub snippet: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DegradedDocument {
    #[napi(js_name = "documentId")]
    pub document_id: String,
    pub path: String,
    pub diagnostics: Vec<Diagnostic>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Suggestion {
    pub suggestion: String,
    pub terms: Vec<String>,
    pub score: f64,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum SearchField {
    Resource,
    Title,
    Heading,
    Description,
    Tags,
    Type,
    Sources,
    Body,
}

impl SearchField {
    const ALL: [Self; 8] = [
        Self::Resource,
        Self::Title,
        Self::Heading,
        Self::Description,
        Self::Tags,
        Self::Type,
        Self::Sources,
        Self::Body,
    ];

    fn parse(value: &str) -> Option<Self> {
        match value {
            "resource" => Some(Self::Resource),
            "title" => Some(Self::Title),
            "heading" => Some(Self::Heading),
            "description" => Some(Self::Description),
            "tags" => Some(Self::Tags),
            "type" => Some(Self::Type),
            "sources" => Some(Self::Sources),
            "body" => Some(Self::Body),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Resource => "resource",
            Self::Title => "title",
            Self::Heading => "heading",
            Self::Description => "description",
            Self::Tags => "tags",
            Self::Type => "type",
            Self::Sources => "sources",
            Self::Body => "body",
        }
    }

    fn baseline_boost(self) -> f32 {
        match self {
            Self::Resource => 6.0,
            Self::Title => 5.0,
            Self::Heading => 4.0,
            Self::Description => 3.0,
            Self::Tags => 2.0,
            Self::Type => 1.5,
            Self::Sources | Self::Body => 1.0,
        }
    }
}

#[derive(Clone)]
struct Fields {
    section_id: Field,
    document_id: Field,
    conformance: Field,
    title: Field,
    path: Field,
    type_text: Field,
    type_exact: Field,
    tags_text: Field,
    tag_exact: Field,
    status: Field,
    stale_after_epoch: Field,
    staleness_classified: Field,
    trust_tier: Field,
    resource: Field,
    heading: Field,
    description: Field,
    sources: Field,
    body: Field,
    start_line: Field,
    end_line: Field,
}

impl Fields {
    fn searchable(&self, field: SearchField) -> Field {
        match field {
            SearchField::Resource => self.resource,
            SearchField::Title => self.title,
            SearchField::Heading => self.heading,
            SearchField::Description => self.description,
            SearchField::Tags => self.tags_text,
            SearchField::Type => self.type_text,
            SearchField::Sources => self.sources,
            SearchField::Body => self.body,
        }
    }
}

fn analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .build()
}

fn schema() -> (Schema, Fields) {
    let mut builder = Schema::builder();
    let indexed = TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer(TOKENIZER)
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored();

    let section_id = builder.add_text_field("section_id", STRING | STORED);
    let document_id = builder.add_text_field("document_id", STRING | STORED);
    let conformance = builder.add_text_field("conformance", STRING | STORED);
    let title = builder.add_text_field("title", indexed.clone());
    let path = builder.add_text_field("path", STORED);
    let type_text = builder.add_text_field("type_text", indexed.clone());
    // Filter-only metadata is indexed but deliberately not stored. Search must
    // express these constraints inside Tantivy instead of reading every top hit
    // back from the document store and filtering in Rust.
    let type_exact = builder.add_text_field("type_exact", STRING);
    let tags_text = builder.add_text_field("tags_text", indexed.clone());
    let tag_exact = builder.add_text_field("tag_exact", STRING);
    let status = builder.add_text_field("status", STRING);
    // Epoch values have high cardinality. A fast field avoids expanding every
    // timestamp term up to `asOf` through the inverted index.
    let stale_after_epoch = builder.add_i64_field("stale_after_epoch", FAST);
    let staleness_classified = builder.add_u64_field("staleness_classified", INDEXED);
    let trust_tier = builder.add_text_field("trust_tier", STRING);
    let resource = builder.add_text_field("resource", indexed.clone());
    let heading = builder.add_text_field("heading", indexed.clone());
    let description = builder.add_text_field("description", indexed.clone());
    let sources = builder.add_text_field("sources", indexed.clone());
    let body = builder.add_text_field("body", indexed);
    let start_line = builder.add_u64_field("start_line", STORED);
    let end_line = builder.add_u64_field("end_line", STORED);

    (
        builder.build(),
        Fields {
            section_id,
            document_id,
            conformance,
            title,
            path,
            type_text,
            type_exact,
            tags_text,
            tag_exact,
            status,
            stale_after_epoch,
            staleness_classified,
            trust_tier,
            resource,
            heading,
            description,
            sources,
            body,
            start_line,
            end_line,
        },
    )
}

#[derive(Clone, Debug, Default)]
struct ResolvedWhere {
    // Deterministic ordering makes the generated term sets stable in tests and
    // query explanations. Filter semantics remain exact and case-sensitive.
    types: Option<BTreeSet<String>>,
    tags_any: Option<BTreeSet<String>>,
    statuses: Option<BTreeSet<String>>,
    trust_tiers: Option<BTreeSet<String>>,
    stale: Option<bool>,
    conformance: Option<BTreeSet<String>>,
}

#[derive(Clone, Debug)]
struct ResolvedOptions {
    limit: usize,
    where_filter: ResolvedWhere,
    as_of_epoch: i64,
    match_all: bool,
    fields: Vec<SearchField>,
    boosts: HashMap<SearchField, f32>,
    fuzzy_ratio: f64,
}

#[derive(Clone, Debug)]
struct QueryPlan {
    terms: Vec<String>,
    options: ResolvedOptions,
}

fn invalid_options(message: impl Into<String>) -> Error {
    Error::new(
        Status::InvalidArg,
        format!("[ERR_OKF_INVALID_SEARCH_OPTIONS] {}", message.into()),
    )
}

fn nonempty_set(values: Option<Vec<String>>) -> Option<BTreeSet<String>> {
    values.and_then(|values| {
        let set: BTreeSet<_> = values.into_iter().collect();
        (!set.is_empty()).then_some(set)
    })
}

fn validate_vocab(
    name: &str,
    values: &Option<BTreeSet<String>>,
    allowed: &[&str],
) -> NapiResult<()> {
    if let Some(values) = values {
        for value in values {
            if !allowed.contains(&value.as_str()) {
                return Err(invalid_options(format!("unknown {name} `{value}`")));
            }
        }
    }
    Ok(())
}

fn resolve_where(value: Option<SearchWhere>) -> NapiResult<ResolvedWhere> {
    let resolved = value.map_or_else(ResolvedWhere::default, |value| ResolvedWhere {
        types: nonempty_set(value.types),
        tags_any: nonempty_set(value.tags_any),
        statuses: nonempty_set(value.statuses),
        trust_tiers: nonempty_set(value.trust_tiers),
        stale: value.stale,
        conformance: nonempty_set(value.conformance),
    });
    validate_vocab(
        "status",
        &resolved.statuses,
        &["draft", "stable", "deprecated"],
    )?;
    validate_vocab(
        "trust tier",
        &resolved.trust_tiers,
        &["unverified", "machine-confirmed", "human-reviewed"],
    )?;
    validate_vocab(
        "conformance",
        &resolved.conformance,
        &["strict", "degraded"],
    )?;
    Ok(resolved)
}

fn boost_value(boost: &Option<SearchBoost>, field: SearchField) -> Option<f64> {
    boost.as_ref().and_then(|boost| match field {
        SearchField::Resource => boost.resource,
        SearchField::Title => boost.title,
        SearchField::Heading => boost.heading,
        SearchField::Description => boost.description,
        SearchField::Tags => boost.tags,
        SearchField::Type => boost.document_type,
        SearchField::Sources => boost.sources,
        SearchField::Body => boost.body,
    })
}

fn resolve_options(options: Option<SearchOptions>) -> NapiResult<ResolvedOptions> {
    let options = options.unwrap_or(SearchOptions {
        limit: None,
        where_filter: None,
        as_of: None,
        match_mode: None,
        fields: None,
        boost: None,
        fuzzy: None,
    });

    let match_all = match options.match_mode.as_deref().unwrap_or("any") {
        "any" => false,
        "all" => true,
        _ => return Err(invalid_options("match must be `any` or `all`")),
    };

    let fields = match options.fields {
        None => SearchField::ALL.to_vec(),
        Some(values) if values.is_empty() => {
            return Err(invalid_options("fields must be a non-empty array"));
        }
        Some(values) => {
            let mut seen = HashSet::new();
            let mut result = Vec::new();
            for value in values {
                let field = SearchField::parse(&value)
                    .ok_or_else(|| invalid_options(format!("unknown field `{value}`")))?;
                if seen.insert(field) {
                    result.push(field);
                }
            }
            result
        }
    };

    let fuzzy_ratio = match options.fuzzy {
        None | Some(Either::A(false)) => 0.0,
        Some(Either::A(true)) => 0.2,
        Some(Either::B(value)) => {
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err(invalid_options("fuzzy must be between 0 and 1"));
            }
            value
        }
    };

    let mut boosts = HashMap::new();
    for field in SearchField::ALL {
        let value = boost_value(&options.boost, field).unwrap_or(field.baseline_boost() as f64);
        if !value.is_finite() || !(0.1..=10.0).contains(&value) {
            return Err(invalid_options(format!(
                "boost.{} must be between 0.1 and 10",
                field.name()
            )));
        }
        boosts.insert(field, value as f32);
    }

    let limit = options.limit.unwrap_or(10.0);
    if !limit.is_finite() || limit < 0.0 || limit.fract() != 0.0 || limit > usize::MAX as f64 {
        return Err(invalid_options(
            "limit must be a finite non-negative integer",
        ));
    }

    Ok(ResolvedOptions {
        limit: limit as usize,
        where_filter: resolve_where(options.where_filter)?,
        as_of_epoch: options.as_of.unwrap_or_else(Utc::now).timestamp_millis(),
        match_all,
        fields,
        boosts,
        fuzzy_ratio,
    })
}

fn tokenize(text: &str) -> Vec<String> {
    let mut analyzer = analyzer();
    let mut stream = analyzer.token_stream(text);
    let mut terms = Vec::new();
    while stream.advance() {
        terms.push(stream.token().text.clone());
    }
    terms
}

fn fuzzy_distance(term: &str, ratio: f64) -> u8 {
    if ratio == 0.0 {
        return 0;
    }
    ((term.chars().count() as f64 * ratio).round() as u8).clamp(1, 2)
}

// The actual branch builder is kept separate so the string is available for
// the fuzzy ratio → discrete edit-distance mapping.
fn field_term_query_text(
    plan: &QueryPlan,
    fields: &Fields,
    field: SearchField,
    text: &str,
    final_term: bool,
    apply_field_boost: bool,
) -> Box<dyn Query> {
    let term = Term::from_field_text(fields.searchable(field), text);
    let mut alternatives: Vec<Box<dyn Query>> = vec![Box::new(TermQuery::new(
        term.clone(),
        IndexRecordOption::WithFreqs,
    ))];
    let distance = fuzzy_distance(text, plan.options.fuzzy_ratio);

    if distance > 0 {
        alternatives.push(Box::new(BoostQuery::new(
            Box::new(FuzzyTermQuery::new(term.clone(), distance, true)),
            0.70,
        )));
    }
    if final_term && text.chars().count() >= 3 {
        alternatives.push(Box::new(BoostQuery::new(
            Box::new(FuzzyTermQuery::new_prefix(term, distance, true)),
            0.50,
        )));
    }

    let mut query: Box<dyn Query> = if alternatives.len() == 1 {
        alternatives.pop().expect("exact query")
    } else {
        // Exact, fuzzy, and prefix are alternative interpretations of one
        // term/field match. Disjunction-max avoids triple-counting an exact
        // term that also satisfies the fuzzy and prefix branches.
        Box::new(DisjunctionMaxQuery::new(alternatives))
    };
    if apply_field_boost {
        query = Box::new(BoostQuery::new(
            query,
            *plan.options.boosts.get(&field).expect("resolved boost"),
        ));
    }
    query
}

fn build_text_query(plan: &QueryPlan, fields: &Fields) -> Option<Box<dyn Query>> {
    if plan.terms.is_empty() {
        return None;
    }
    let final_index = plan.terms.len() - 1;
    let term_queries: Vec<Box<dyn Query>> = plan
        .terms
        .iter()
        .enumerate()
        .map(|(index, term)| {
            let field_queries: Vec<Box<dyn Query>> = plan
                .options
                .fields
                .iter()
                .map(|field| {
                    field_term_query_text(plan, fields, *field, term, index == final_index, true)
                })
                .collect();
            Box::new(BooleanQuery::union(field_queries)) as Box<dyn Query>
        })
        .collect();
    let query: Box<dyn Query> = if plan.options.match_all {
        Box::new(BooleanQuery::intersection(term_queries))
    } else {
        Box::new(BooleanQuery::union(term_queries))
    };
    Some(query)
}

fn exact_values_query(field: Field, values: &BTreeSet<String>) -> Box<dyn Query> {
    Box::new(TermSetQuery::new(
        values
            .iter()
            .map(|value| Term::from_field_text(field, value)),
    ))
}

fn classified_query(fields: &Fields) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_u64(fields.staleness_classified, 1),
        IndexRecordOption::Basic,
    ))
}

fn stale_at_or_before_query(fields: &Fields, as_of_epoch: i64) -> Box<dyn Query> {
    Box::new(FastFieldRangeQuery::new(
        Bound::Unbounded,
        Bound::Included(Term::from_field_i64(fields.stale_after_epoch, as_of_epoch)),
    ))
}

fn build_filter_query(
    filter: &ResolvedWhere,
    fields: &Fields,
    as_of_epoch: i64,
) -> Option<Box<dyn Query>> {
    let mut clauses: Vec<Box<dyn Query>> = Vec::new();

    if let Some(values) = &filter.types {
        clauses.push(exact_values_query(fields.type_exact, values));
    }
    if let Some(values) = &filter.tags_any {
        clauses.push(exact_values_query(fields.tag_exact, values));
    }
    if let Some(values) = &filter.statuses {
        clauses.push(exact_values_query(fields.status, values));
    }
    if let Some(values) = &filter.trust_tiers {
        clauses.push(exact_values_query(fields.trust_tier, values));
    }
    if let Some(values) = &filter.conformance {
        clauses.push(exact_values_query(fields.conformance, values));
    }
    if let Some(wants_stale) = filter.stale {
        let stale_query = stale_at_or_before_query(fields, as_of_epoch);
        let stale_clause: Box<dyn Query> = if wants_stale {
            Box::new(BooleanQuery::new(vec![
                (Occur::Must, classified_query(fields)),
                (Occur::Must, stale_query),
            ]))
        } else {
            // `stale: false` means explicitly classified and not stale at
            // `asOf`. Missing staleAfterEpoch therefore matches false, while
            // unclassified degraded sections match neither stale branch.
            Box::new(BooleanQuery::new(vec![
                (Occur::Must, classified_query(fields)),
                (Occur::MustNot, stale_query),
            ]))
        };
        clauses.push(stale_clause);
    }

    match clauses.len() {
        0 => None,
        1 => clauses.pop(),
        _ => Some(Box::new(BooleanQuery::intersection(clauses))),
    }
}

fn build_query(plan: &QueryPlan, fields: &Fields) -> Option<Box<dyn Query>> {
    let text_query = build_text_query(plan, fields)?;
    let Some(filter_query) =
        build_filter_query(&plan.options.where_filter, fields, plan.options.as_of_epoch)
    else {
        return Some(text_query);
    };

    // Metadata must constrain the matching document set without changing BM25
    // scores. A zero-score wrapper makes that invariant explicit even though
    // several individual filter primitives already happen to score constantly.
    Some(Box::new(BooleanQuery::new(vec![
        (Occur::Must, text_query),
        (
            Occur::Must,
            Box::new(ConstScoreQuery::new(filter_query, 0.0)),
        ),
    ])))
}

fn field_probe(plan: &QueryPlan, fields: &Fields, field: SearchField) -> Box<dyn Query> {
    let final_index = plan.terms.len() - 1;
    let clauses: Vec<Box<dyn Query>> = plan
        .terms
        .iter()
        .enumerate()
        .map(|(index, term)| {
            field_term_query_text(plan, fields, field, term, index == final_index, false)
        })
        .collect();
    Box::new(BooleanQuery::union(clauses))
}

#[derive(Debug, ThisError)]
enum EngineError {
    #[error("[ERR_OKF_INVALID_PREPARED_DOCUMENT] {0}")]
    Invalid(String),
    #[error("[ERR_OKF_INDEX_UNUSABLE] {0}")]
    Poisoned(String),
    #[error("[ERR_OKF_NATIVE] {0}")]
    Tantivy(#[from] tantivy::TantivyError),
}

#[derive(Clone)]
struct DocumentState {
    document_id: String,
    path: String,
    document_type: String,
    conformance: String,
    diagnostics: Vec<Diagnostic>,
    section_ids: BTreeSet<String>,
    section_count: usize,
}

impl From<&PreparedDocument> for DocumentState {
    fn from(value: &PreparedDocument) -> Self {
        Self {
            document_id: value.document_id.clone(),
            path: value.path.clone(),
            document_type: value.document_type.clone(),
            conformance: value.conformance.clone(),
            diagnostics: value.diagnostics.clone(),
            section_ids: value
                .sections
                .iter()
                .map(|section| section.section_id.clone())
                .collect(),
            section_count: value.sections.len(),
        }
    }
}

#[derive(Clone)]
struct Record {
    address: DocAddress,
    document_id: String,
    title: String,
    section_id: String,
    conformance: String,
    heading_path: String,
    path: String,
    start_line: u32,
    end_line: u32,
    text: String,
}

#[derive(Clone)]
struct Candidate {
    score: Score,
    record: Record,
}

struct Engine {
    _index: Index,
    reader: IndexReader,
    writer: IndexWriter,
    fields: Fields,
    documents: BTreeMap<String, DocumentState>,
    poisoned: Option<String>,
}

impl Engine {
    fn new(documents: Vec<PreparedDocument>) -> Result<Self, EngineError> {
        validate_set(&documents)?;
        let (schema, fields) = schema();
        let index = Index::create_in_ram(schema);
        index.tokenizers().register(TOKENIZER, analyzer());
        let mut writer = index.writer(WRITER_HEAP_BYTES)?;
        let mut states = BTreeMap::new();
        for document in &documents {
            add_document(&writer, &fields, document)?;
            states.insert(document.document_id.clone(), DocumentState::from(document));
        }
        writer.commit()?;
        let reader: IndexReader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        reader.reload()?;
        Ok(Self {
            _index: index,
            reader,
            writer,
            fields,
            documents: states,
            poisoned: None,
        })
    }

    fn usable(&self) -> Result<(), EngineError> {
        self.poisoned
            .as_ref()
            .map_or(Ok(()), |cause| Err(EngineError::Poisoned(cause.clone())))
    }

    fn poison<T>(&mut self, cause: impl Into<String>) -> Result<T, EngineError> {
        let cause = cause.into();
        self.poisoned = Some(cause.clone());
        Err(EngineError::Poisoned(cause))
    }

    fn count(&self, document_id: &str) -> Result<usize, EngineError> {
        let query = TermQuery::new(
            Term::from_field_text(self.fields.document_id, document_id),
            IndexRecordOption::Basic,
        );
        Ok(self.reader.searcher().search(&query, &Count)?)
    }

    fn verify_count(&mut self, document_id: &str, expected: usize) -> Result<(), EngineError> {
        let actual = self.count(document_id)?;
        if actual == expected {
            return Ok(());
        }
        self.poison(format!(
            "document `{document_id}` owns {actual} sections; state expects {expected}"
        ))
    }

    fn commit(&mut self, operation: &str) -> Result<(), EngineError> {
        if let Err(error) = self.writer.commit() {
            return self.poison(format!("{operation} commit failed: {error}"));
        }
        if let Err(error) = self.reader.reload() {
            return self.poison(format!("{operation} reload failed: {error}"));
        }
        Ok(())
    }

    fn ingest(&mut self, document: PreparedDocument) -> Result<(), EngineError> {
        self.usable()?;
        validate_document(&document)?;

        if let Some(existing) = self.documents.get(&document.document_id) {
            if existing.path != document.path {
                return Err(EngineError::Invalid(format!(
                    "replacement documentId `{}` changed path from `{}` to `{}`",
                    document.document_id, existing.path, document.path
                )));
            }
        }
        if let Some(conflict) = self
            .documents
            .values()
            .find(|state| state.document_id != document.document_id && state.path == document.path)
        {
            return Err(EngineError::Invalid(format!(
                "path `{}` is already owned by documentId `{}`",
                document.path, conflict.document_id
            )));
        }
        for section in &document.sections {
            if let Some(conflict) = self.documents.values().find(|state| {
                state.document_id != document.document_id
                    && state.section_ids.contains(&section.section_id)
            }) {
                return Err(EngineError::Invalid(format!(
                    "sectionId `{}` is already owned by documentId `{}`",
                    section.section_id, conflict.document_id
                )));
            }
        }

        let previous = self
            .documents
            .get(&document.document_id)
            .map_or(0, |state| state.section_count);
        self.verify_count(&document.document_id, previous)?;

        self.writer.delete_term(Term::from_field_text(
            self.fields.document_id,
            &document.document_id,
        ));
        if let Err(error) = add_document(&self.writer, &self.fields, &document) {
            return self.poison(format!(
                "replacement `{}` could not be staged: {error}",
                document.document_id
            ));
        }
        self.commit(&format!("replace `{}`", document.document_id))?;
        let count = document.sections.len();
        self.documents
            .insert(document.document_id.clone(), DocumentState::from(&document));
        self.verify_count(&document.document_id, count)
    }

    fn remove(&mut self, identity: RemoveIdentity) -> Result<bool, EngineError> {
        self.usable()?;
        let Some(existing) = self.documents.get(&identity.document_id).cloned() else {
            self.verify_count(&identity.document_id, 0)?;
            return Ok(false);
        };
        if existing.path != identity.path {
            return Err(EngineError::Invalid(format!(
                "remove path `{}` disagrees with indexed path `{}`",
                identity.path, existing.path
            )));
        }
        self.verify_count(&identity.document_id, existing.section_count)?;
        self.writer.delete_term(Term::from_field_text(
            self.fields.document_id,
            &identity.document_id,
        ));
        self.commit(&format!("remove `{}`", identity.document_id))?;
        self.documents.remove(&identity.document_id);
        self.verify_count(&identity.document_id, 0)?;
        Ok(true)
    }

    fn list_types(&self) -> Result<Vec<String>, EngineError> {
        self.usable()?;
        Ok(self
            .documents
            .values()
            .map(|state| state.document_type.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect())
    }

    fn list_degraded(&self) -> Result<Vec<DegradedDocument>, EngineError> {
        self.usable()?;
        let mut documents: Vec<_> = self
            .documents
            .values()
            .filter(|state| state.conformance == "degraded")
            .map(|state| DegradedDocument {
                document_id: state.document_id.clone(),
                path: state.path.clone(),
                diagnostics: state.diagnostics.clone(),
            })
            .collect();
        documents.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(documents)
    }

    fn search(&self, text: &str, options: Option<SearchOptions>) -> NapiResult<Vec<SearchHit>> {
        self.usable().map_err(native_error)?;
        let plan = QueryPlan {
            terms: tokenize(text.trim()),
            options: resolve_options(options)?,
        };
        if plan.terms.is_empty() || plan.options.limit == 0 {
            return Ok(Vec::new());
        }
        let query = build_query(&plan, &self.fields).expect("non-empty query");
        let searcher = self.reader.searcher();
        let live = searcher.num_docs() as usize;
        if live == 0 {
            return Ok(Vec::new());
        }

        let mut fetch = plan
            .options
            .limit
            .saturating_mul(4)
            .max(FETCH_FLOOR)
            .min(live);
        let selected = loop {
            let requested = fetch.saturating_add(1).min(live);
            let top = searcher
                .search(
                    query.as_ref(),
                    &TopDocs::with_limit(requested).order_by_score(),
                )
                .map_err(|e| native_error(e.into()))?;
            let has_more = top.len() > fetch;
            let mut candidates = Vec::with_capacity(fetch.min(top.len()));
            for (score, address) in top.iter().take(fetch).copied() {
                let record = read_record(&searcher, &self.fields, address).map_err(native_error)?;
                candidates.push(Candidate { score, record });
            }
            let ranked = collapse(candidates);
            let enough = ranked.len() >= plan.options.limit;
            let boundary = enough.then(|| ranked[plan.options.limit - 1].score);
            let next_score = top.get(fetch).map(|(score, _)| *score);
            let closed = matches!((boundary, next_score), (Some(a), Some(b)) if b < a)
                || matches!((boundary, next_score), (Some(_), None));
            if !has_more || (enough && closed) || fetch >= live {
                break ranked;
            }
            let next = fetch.saturating_mul(2).min(live);
            if next == fetch {
                break ranked;
            }
            fetch = next;
        };

        selected
            .into_iter()
            .take(plan.options.limit)
            .map(|candidate| to_hit(&searcher, &self.fields, &plan, candidate))
            .collect::<Result<Vec<_>, _>>()
            .map_err(native_error)
    }
}

fn validate_set(documents: &[PreparedDocument]) -> Result<(), EngineError> {
    let mut document_ids = HashSet::new();
    let mut paths = HashSet::new();
    let mut section_ids = HashSet::new();

    for document in documents {
        validate_document(document)?;
        if !document_ids.insert(document.document_id.as_str()) {
            return Err(EngineError::Invalid(format!(
                "duplicate documentId `{}`",
                document.document_id
            )));
        }
        if !paths.insert(document.path.as_str()) {
            return Err(EngineError::Invalid(format!(
                "duplicate path `{}`",
                document.path
            )));
        }
        for section in &document.sections {
            if !section_ids.insert(section.section_id.as_str()) {
                return Err(EngineError::Invalid(format!(
                    "duplicate sectionId `{}`",
                    section.section_id
                )));
            }
        }
    }
    Ok(())
}

fn validate_document(document: &PreparedDocument) -> Result<(), EngineError> {
    if document.document_id.trim().is_empty() {
        return Err(EngineError::Invalid("documentId must not be empty".into()));
    }
    if document.path.trim().is_empty() {
        return Err(EngineError::Invalid(format!(
            "document `{}` has an empty path",
            document.document_id
        )));
    }
    if document.document_type.trim().is_empty() {
        return Err(EngineError::Invalid(format!(
            "document `{}` has an empty type",
            document.document_id
        )));
    }
    if !matches!(document.conformance.as_str(), "strict" | "degraded") {
        return Err(EngineError::Invalid(format!(
            "document `{}` has invalid conformance `{}`",
            document.document_id, document.conformance
        )));
    }
    match document.conformance.as_str() {
        "strict" if !document.diagnostics.is_empty() => {
            return Err(EngineError::Invalid(format!(
                "strict document `{}` must not have diagnostics",
                document.document_id
            )));
        }
        "degraded" if document.diagnostics.is_empty() => {
            return Err(EngineError::Invalid(format!(
                "degraded document `{}` must have at least one diagnostic",
                document.document_id
            )));
        }
        _ => {}
    }
    if let Some(diagnostic) = document.diagnostics.iter().find(|diagnostic| {
        diagnostic.path != document.path
            || !matches!(diagnostic.code.as_str(), "ERR_OKF_PARSE" | "ERR_OKF_FIELD")
    }) {
        return Err(EngineError::Invalid(format!(
            "document `{}` has invalid diagnostic `{}` for path `{}`",
            document.document_id, diagnostic.code, diagnostic.path
        )));
    }
    if document.sections.is_empty() {
        return Err(EngineError::Invalid(format!(
            "document `{}` has no projected sections",
            document.document_id
        )));
    }

    let mut ids = HashSet::new();
    for section in &document.sections {
        if section.section_id.trim().is_empty() {
            return Err(EngineError::Invalid(format!(
                "document `{}` contains an empty sectionId",
                document.document_id
            )));
        }
        if !ids.insert(section.section_id.as_str()) {
            return Err(EngineError::Invalid(format!(
                "document `{}` repeats sectionId `{}`",
                document.document_id, section.section_id
            )));
        }
        if section.document_id != document.document_id
            || section.path != document.path
            || section.document_type != document.document_type
            || section.conformance != document.conformance
        {
            return Err(EngineError::Invalid(format!(
                "section `{}` disagrees with its document envelope",
                section.section_id
            )));
        }
        if section.start_line == 0 || section.end_line < section.start_line {
            return Err(EngineError::Invalid(format!(
                "section `{}` has invalid line bounds {}..{}",
                section.section_id, section.start_line, section.end_line
            )));
        }
        if let Some(value) = section.stale_after_epoch {
            if !value.is_finite() || value < i64::MIN as f64 || value > i64::MAX as f64 {
                return Err(EngineError::Invalid(format!(
                    "section `{}` has an invalid staleAfterEpoch",
                    section.section_id
                )));
            }
        }
        if let Some(status) = section.status.as_deref() {
            if !matches!(status, "draft" | "stable" | "deprecated") {
                return Err(EngineError::Invalid(format!(
                    "section `{}` has invalid status `{status}`",
                    section.section_id
                )));
            }
        }
        if let Some(tier) = section.trust_tier.as_deref() {
            if !matches!(tier, "unverified" | "machine-confirmed" | "human-reviewed") {
                return Err(EngineError::Invalid(format!(
                    "section `{}` has invalid trustTier `{tier}`",
                    section.section_id
                )));
            }
        }
    }
    Ok(())
}

fn add_document(
    writer: &IndexWriter,
    fields: &Fields,
    document: &PreparedDocument,
) -> Result<(), EngineError> {
    for section in &document.sections {
        add_section(writer, fields, section)?;
    }
    Ok(())
}

fn add_section(
    writer: &IndexWriter,
    fields: &Fields,
    section: &PreparedSection,
) -> Result<(), EngineError> {
    let mut doc = TantivyDocument::default();
    doc.add_text(fields.section_id, &section.section_id);
    doc.add_text(fields.document_id, &section.document_id);
    doc.add_text(fields.conformance, &section.conformance);
    doc.add_text(fields.title, &section.title);
    doc.add_text(fields.path, &section.path);
    doc.add_text(fields.type_text, &section.document_type);
    doc.add_text(fields.type_exact, &section.document_type);
    for tag in &section.tags {
        doc.add_text(fields.tags_text, tag);
        doc.add_text(fields.tag_exact, tag);
    }
    if let Some(status) = &section.status {
        doc.add_text(fields.status, status);
    }
    if let Some(epoch) = section.stale_after_epoch {
        doc.add_i64(fields.stale_after_epoch, epoch.round() as i64);
    }
    // The positive marker is sufficient: missing means unclassified. Avoiding
    // a posting for the overwhelmingly uninteresting false value keeps this
    // filter field compact.
    if section.staleness_classified {
        doc.add_u64(fields.staleness_classified, 1);
    }
    if let Some(tier) = &section.trust_tier {
        doc.add_text(fields.trust_tier, tier);
    }
    doc.add_text(fields.resource, &section.resource);
    doc.add_text(fields.heading, &section.heading_path);
    doc.add_text(fields.description, &section.description);
    doc.add_text(fields.sources, &section.source_text);
    doc.add_text(fields.body, &section.text);
    doc.add_u64(fields.start_line, section.start_line as u64);
    doc.add_u64(fields.end_line, section.end_line as u64);
    writer.add_document(doc)?;
    Ok(())
}

fn required_text(doc: &TantivyDocument, field: Field, name: &str) -> Result<String, EngineError> {
    doc.get_first(field)
        .and_then(|value| value.as_value().as_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            EngineError::Invalid(format!(
                "stored Tantivy document is missing text field `{name}`"
            ))
        })
}

fn required_u64(doc: &TantivyDocument, field: Field, name: &str) -> Result<u64, EngineError> {
    doc.get_first(field)
        .and_then(|value| value.as_value().as_u64())
        .ok_or_else(|| {
            EngineError::Invalid(format!(
                "stored Tantivy document is missing u64 field `{name}`"
            ))
        })
}

fn read_record(
    searcher: &tantivy::Searcher,
    fields: &Fields,
    address: DocAddress,
) -> Result<Record, EngineError> {
    let doc = searcher.doc::<TantivyDocument>(address)?;
    let start_line = required_u64(&doc, fields.start_line, "start_line")?;
    let end_line = required_u64(&doc, fields.end_line, "end_line")?;
    Ok(Record {
        address,
        document_id: required_text(&doc, fields.document_id, "document_id")?,
        title: required_text(&doc, fields.title, "title")?,
        section_id: required_text(&doc, fields.section_id, "section_id")?,
        conformance: required_text(&doc, fields.conformance, "conformance")?,
        heading_path: required_text(&doc, fields.heading, "heading")?,
        path: required_text(&doc, fields.path, "path")?,
        start_line: u32::try_from(start_line)
            .map_err(|_| EngineError::Invalid("stored start_line exceeds u32".into()))?,
        end_line: u32::try_from(end_line)
            .map_err(|_| EngineError::Invalid("stored end_line exceeds u32".into()))?,
        text: required_text(&doc, fields.body, "body")?,
    })
}

fn conformance_rank(value: &str) -> u8 {
    if value == "strict" { 0 } else { 1 }
}

fn compare_candidates(left: &Candidate, right: &Candidate) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| {
            conformance_rank(&left.record.conformance)
                .cmp(&conformance_rank(&right.record.conformance))
        })
        .then_with(|| left.record.section_id.cmp(&right.record.section_id))
}

fn collapse(mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    candidates.sort_by(compare_candidates);
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.record.document_id.clone()))
        .collect()
}

fn floor_char_boundary(text: &str, mut offset: usize) -> usize {
    offset = offset.min(text.len());
    while offset > 0 && !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

fn make_snippet(text: &str, terms: &[String], max_length: usize) -> String {
    // ASCII lowercasing keeps byte offsets aligned with the original string. For
    // non-ASCII case folding we deliberately fall back to a leading snippet.
    let lower = text.to_ascii_lowercase();
    let first_match = terms
        .iter()
        .filter_map(|term| lower.find(&term.to_ascii_lowercase()))
        .min();
    let raw_start = first_match.map_or(0, |position| position.saturating_sub(80));
    let start = floor_char_boundary(text, raw_start);
    let end = floor_char_boundary(text, start.saturating_add(max_length).min(text.len()));
    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.push_str(text[start..end].trim());
    if end < text.len() {
        snippet.push('…');
    }
    snippet
}

fn matched_fields(
    searcher: &tantivy::Searcher,
    fields: &Fields,
    plan: &QueryPlan,
    address: DocAddress,
) -> Vec<String> {
    plan.options
        .fields
        .iter()
        .copied()
        .filter(|field| {
            let probe = field_probe(plan, fields, *field);
            probe.explain(searcher, address).is_ok()
        })
        .map(|field| field.name().to_owned())
        .collect()
}

fn to_hit(
    searcher: &tantivy::Searcher,
    fields: &Fields,
    plan: &QueryPlan,
    candidate: Candidate,
) -> Result<SearchHit, EngineError> {
    let record = candidate.record;
    let matched_fields = matched_fields(searcher, fields, plan, record.address);
    Ok(SearchHit {
        document_id: record.document_id,
        title: record.title,
        section_id: record.section_id,
        score: candidate.score as f64,
        conformance: record.conformance,
        matched_fields,
        heading_path: record.heading_path,
        path: record.path,
        start_line: record.start_line,
        end_line: record.end_line,
        snippet: make_snippet(&record.text, &plan.terms, 240),
    })
}

fn native_error(error: EngineError) -> Error {
    let status = match &error {
        EngineError::Invalid(_) => Status::InvalidArg,
        EngineError::Poisoned(_) | EngineError::Tantivy(_) => Status::GenericFailure,
    };
    Error::new(status, error.to_string())
}

/// Native search handle. The public TypeScript adapter should keep accepting
/// raw Markdown and use the existing OKF parser/projector before crossing this
/// boundary.
#[napi]
pub struct NativeOkfSearch {
    inner: Mutex<Engine>,
}

#[napi]
impl NativeOkfSearch {
    #[napi(factory, js_name = "fromPrepared")]
    pub fn from_prepared(documents: Vec<PreparedDocument>) -> Result<Self, Error> {
        let engine = Engine::new(documents).map_err(native_error)?;
        Ok(Self {
            inner: Mutex::new(engine),
        })
    }

    #[napi(js_name = "ingestPrepared")]
    pub fn ingest_prepared(&self, document: PreparedDocument) -> Result<(), Error> {
        self.inner.lock().ingest(document).map_err(native_error)
    }

    #[napi(js_name = "removeDocument")]
    pub fn remove_document(&self, identity: RemoveIdentity) -> Result<bool, Error> {
        self.inner.lock().remove(identity).map_err(native_error)
    }

    #[napi]
    pub fn search(
        &self,
        query: String,
        options: Option<SearchOptions>,
    ) -> Result<Vec<SearchHit>, Error> {
        self.inner.lock().search(&query, options)
    }

    #[napi(js_name = "listTypes")]
    pub fn list_types(&self) -> Result<Vec<String>, Error> {
        self.inner.lock().list_types().map_err(native_error)
    }

    #[napi(js_name = "listDegradedDocuments")]
    pub fn list_degraded_documents(&self) -> Result<Vec<DegradedDocument>, Error> {
        self.inner.lock().list_degraded().map_err(native_error)
    }

    /// Tantivy exposes the pieces needed to build completion, but not the
    /// section-aware MiniSearch `autoSuggest` contract. Returning ordinary
    /// search hits as suggestions would be misleading, so this spike fails
    /// explicitly instead.
    #[napi(js_name = "autoSuggest")]
    pub fn auto_suggest(
        &self,
        _query: String,
        _options: Option<SearchOptions>,
    ) -> Result<Vec<Suggestion>, Error> {
        self.inner.lock().usable().map_err(native_error)?;
        Err(Error::new(
            Status::GenericFailure,
            "[ERR_OKF_UNSUPPORTED] autoSuggest is not implemented by the Tantivy backend",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BEFORE: i64 = 999;
    const FIRST_DEADLINE: i64 = 1_000;
    const SECOND_DEADLINE: i64 = 3_000;

    #[allow(clippy::too_many_arguments)]
    fn section(
        document_id: &str,
        document_type: &str,
        conformance: &str,
        tags: &[&str],
        status: Option<&str>,
        stale_after_epoch: Option<i64>,
        staleness_classified: bool,
        trust_tier: Option<&str>,
    ) -> PreparedSection {
        let path = format!("{document_id}.md");
        PreparedSection {
            section_id: format!("{document_id}#root"),
            document_id: document_id.to_owned(),
            conformance: conformance.to_owned(),
            title: format!("Memory architecture for {document_id}"),
            path,
            document_type: document_type.to_owned(),
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            status: status.map(str::to_owned),
            stale_after_epoch: stale_after_epoch.map(|epoch| epoch as f64),
            staleness_classified,
            trust_tier: trust_tier.map(str::to_owned),
            resource: document_id.to_owned(),
            heading_path: "Overview".to_owned(),
            description: "Memory architecture reference".to_owned(),
            source_text: String::new(),
            text: "Memory architecture keeps retrieval predictable.".to_owned(),
            start_line: 1,
            end_line: 3,
        }
    }

    fn document(section: PreparedSection) -> PreparedDocument {
        let diagnostics = if section.conformance == "degraded" {
            vec![Diagnostic {
                code: "ERR_OKF_FIELD".to_owned(),
                message: "fixture degradation".to_owned(),
                field: Some("stale_after".to_owned()),
                path: section.path.clone(),
            }]
        } else {
            Vec::new()
        };
        PreparedDocument {
            document_id: section.document_id.clone(),
            path: section.path.clone(),
            document_type: section.document_type.clone(),
            conformance: section.conformance.clone(),
            diagnostics,
            sections: vec![section],
        }
    }

    fn fixture_engine() -> Engine {
        Engine::new(vec![
            document(section(
                "decision",
                "Decision",
                "strict",
                &["memory", "architecture"],
                Some("stable"),
                Some(FIRST_DEADLINE),
                true,
                Some("human-reviewed"),
            )),
            document(section(
                "reference",
                "Reference",
                "strict",
                &["memory", "docs"],
                Some("draft"),
                Some(SECOND_DEADLINE),
                true,
                Some("machine-confirmed"),
            )),
            document(section(
                "classified-without-deadline",
                "Note",
                "strict",
                &["memory"],
                Some("stable"),
                None,
                true,
                Some("unverified"),
            )),
            document(section(
                "unclassified",
                "Note",
                "degraded",
                &["memory"],
                None,
                None,
                false,
                None,
            )),
        ])
        .expect("fixture should index")
    }

    fn where_filter() -> SearchWhere {
        SearchWhere {
            types: None,
            tags_any: None,
            statuses: None,
            trust_tiers: None,
            stale: None,
            conformance: None,
        }
    }

    fn options(where_filter: Option<SearchWhere>, as_of_epoch: i64) -> SearchOptions {
        SearchOptions {
            limit: Some(50.0),
            where_filter,
            as_of: Some(
                DateTime::<Utc>::from_timestamp_millis(as_of_epoch).expect("fixture timestamp"),
            ),
            match_mode: None,
            fields: Some(vec!["body".to_owned()]),
            boost: None,
            fuzzy: None,
        }
    }

    fn result_ids(
        engine: &Engine,
        where_filter: Option<SearchWhere>,
        as_of_epoch: i64,
    ) -> BTreeSet<String> {
        engine
            .search("memory", Some(options(where_filter, as_of_epoch)))
            .expect("search should succeed")
            .into_iter()
            .map(|hit| hit.document_id)
            .collect()
    }

    #[test]
    fn exact_metadata_filters_are_pushed_into_tantivy() {
        let engine = fixture_engine();

        let mut filter = where_filter();
        filter.types = Some(vec!["Decision".to_owned(), "Reference".to_owned()]);
        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            BTreeSet::from(["decision".to_owned(), "reference".to_owned()]),
        );

        let mut filter = where_filter();
        filter.tags_any = Some(vec!["docs".to_owned(), "missing".to_owned()]);
        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            BTreeSet::from(["reference".to_owned()]),
        );

        let mut filter = where_filter();
        filter.statuses = Some(vec!["stable".to_owned()]);
        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            BTreeSet::from([
                "classified-without-deadline".to_owned(),
                "decision".to_owned(),
            ]),
        );

        let mut filter = where_filter();
        filter.trust_tiers = Some(vec!["human-reviewed".to_owned()]);
        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            BTreeSet::from(["decision".to_owned()]),
        );

        let mut filter = where_filter();
        filter.conformance = Some(vec!["degraded".to_owned()]);
        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            BTreeSet::from(["unclassified".to_owned()]),
        );
    }

    #[test]
    fn filter_dimensions_intersect_and_values_within_a_dimension_union() {
        let engine = fixture_engine();
        let mut filter = where_filter();
        filter.types = Some(vec!["Decision".to_owned(), "Reference".to_owned()]);
        filter.tags_any = Some(vec!["architecture".to_owned(), "missing".to_owned()]);
        filter.statuses = Some(vec!["stable".to_owned()]);
        filter.trust_tiers = Some(vec!["human-reviewed".to_owned()]);
        filter.conformance = Some(vec!["strict".to_owned()]);

        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            BTreeSet::from(["decision".to_owned()]),
        );
    }

    #[test]
    fn empty_filter_arrays_remain_no_ops() {
        let engine = fixture_engine();
        let mut filter = where_filter();
        filter.types = Some(Vec::new());
        filter.tags_any = Some(Vec::new());
        filter.statuses = Some(Vec::new());
        filter.trust_tiers = Some(Vec::new());
        filter.conformance = Some(Vec::new());

        assert_eq!(
            result_ids(&engine, Some(filter), BEFORE),
            result_ids(&engine, None, BEFORE),
        );
    }

    #[test]
    fn stale_filter_preserves_classification_and_boundary_semantics() {
        let engine = fixture_engine();

        let mut stale = where_filter();
        stale.stale = Some(true);
        assert!(result_ids(&engine, Some(stale.clone()), BEFORE).is_empty());
        assert_eq!(
            result_ids(&engine, Some(stale.clone()), FIRST_DEADLINE),
            BTreeSet::from(["decision".to_owned()]),
        );
        assert_eq!(
            result_ids(&engine, Some(stale), SECOND_DEADLINE),
            BTreeSet::from(["decision".to_owned(), "reference".to_owned()]),
        );

        let mut fresh = where_filter();
        fresh.stale = Some(false);
        assert_eq!(
            result_ids(&engine, Some(fresh.clone()), BEFORE),
            BTreeSet::from([
                "classified-without-deadline".to_owned(),
                "decision".to_owned(),
                "reference".to_owned(),
            ]),
        );
        assert_eq!(
            result_ids(&engine, Some(fresh.clone()), FIRST_DEADLINE),
            BTreeSet::from([
                "classified-without-deadline".to_owned(),
                "reference".to_owned(),
            ]),
        );
        assert_eq!(
            result_ids(&engine, Some(fresh), SECOND_DEADLINE),
            BTreeSet::from(["classified-without-deadline".to_owned()]),
        );
    }

    #[test]
    fn pushdown_restricts_the_tantivy_candidate_set_before_document_loading() {
        let engine = fixture_engine();
        let searcher = engine.reader.searcher();

        let unfiltered_plan = QueryPlan {
            terms: tokenize("memory"),
            options: resolve_options(Some(options(None, BEFORE))).expect("unfiltered options"),
        };
        let unfiltered_query =
            build_query(&unfiltered_plan, &engine.fields).expect("unfiltered query");
        assert_eq!(
            searcher
                .search(unfiltered_query.as_ref(), &Count)
                .expect("count"),
            4,
        );

        let mut filter = where_filter();
        filter.types = Some(vec!["Decision".to_owned()]);
        filter.tags_any = Some(vec!["architecture".to_owned()]);
        filter.statuses = Some(vec!["stable".to_owned()]);
        let filtered_plan = QueryPlan {
            terms: tokenize("memory"),
            options: resolve_options(Some(options(Some(filter), BEFORE)))
                .expect("filtered options"),
        };
        let filtered_query = build_query(&filtered_plan, &engine.fields).expect("filtered query");
        assert_eq!(
            searcher
                .search(filtered_query.as_ref(), &Count)
                .expect("count"),
            1,
        );
    }

    #[test]
    fn metadata_filters_do_not_change_text_scores() {
        let engine = fixture_engine();
        let unfiltered = engine
            .search("memory", Some(options(None, BEFORE)))
            .expect("unfiltered search");
        let baseline = unfiltered
            .iter()
            .find(|hit| hit.document_id == "decision")
            .expect("decision hit")
            .score;

        let mut filter = where_filter();
        filter.types = Some(vec!["Decision".to_owned()]);
        filter.tags_any = Some(vec!["architecture".to_owned()]);
        filter.statuses = Some(vec!["stable".to_owned()]);
        filter.trust_tiers = Some(vec!["human-reviewed".to_owned()]);
        filter.conformance = Some(vec!["strict".to_owned()]);
        filter.stale = Some(false);
        let filtered = engine
            .search("memory", Some(options(Some(filter), BEFORE)))
            .expect("filtered search");

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].document_id, "decision");
        assert_eq!(filtered[0].score.to_bits(), baseline.to_bits());
    }

    #[test]
    fn pushed_metadata_terms_follow_replacement_and_removal() {
        let mut engine = fixture_engine();

        let mut old_filter = where_filter();
        old_filter.types = Some(vec!["Decision".to_owned()]);
        old_filter.tags_any = Some(vec!["architecture".to_owned()]);
        old_filter.statuses = Some(vec!["stable".to_owned()]);
        old_filter.trust_tiers = Some(vec!["human-reviewed".to_owned()]);
        assert_eq!(
            result_ids(&engine, Some(old_filter.clone()), BEFORE),
            BTreeSet::from(["decision".to_owned()]),
        );

        engine
            .ingest(document(section(
                "decision",
                "Guide",
                "strict",
                &["docs", "rust"],
                Some("draft"),
                Some(SECOND_DEADLINE),
                true,
                Some("unverified"),
            )))
            .expect("replacement should commit");

        assert!(result_ids(&engine, Some(old_filter), BEFORE).is_empty());

        let mut replacement_filter = where_filter();
        replacement_filter.types = Some(vec!["Guide".to_owned()]);
        replacement_filter.tags_any = Some(vec!["rust".to_owned()]);
        replacement_filter.statuses = Some(vec!["draft".to_owned()]);
        replacement_filter.trust_tiers = Some(vec!["unverified".to_owned()]);
        replacement_filter.stale = Some(false);
        assert_eq!(
            result_ids(&engine, Some(replacement_filter.clone()), BEFORE),
            BTreeSet::from(["decision".to_owned()]),
        );

        assert!(
            engine
                .remove(RemoveIdentity {
                    document_id: "decision".to_owned(),
                    path: "decision.md".to_owned(),
                })
                .expect("remove should commit")
        );
        assert!(result_ids(&engine, Some(replacement_filter), BEFORE).is_empty());
    }

    #[test]
    fn filter_only_metadata_is_not_readable_from_the_document_store() {
        let engine = fixture_engine();
        let searcher = engine.reader.searcher();
        let query = TermQuery::new(
            Term::from_field_text(engine.fields.body, "memory"),
            IndexRecordOption::WithFreqs,
        );
        let top = searcher
            .search(&query, &TopDocs::with_limit(1).order_by_score())
            .expect("top doc");
        let address = top[0].1;
        let doc = searcher
            .doc::<TantivyDocument>(address)
            .expect("stored document");

        assert!(doc.get_first(engine.fields.type_exact).is_none());
        assert!(doc.get_first(engine.fields.tag_exact).is_none());
        assert!(doc.get_first(engine.fields.status).is_none());
        assert!(doc.get_first(engine.fields.stale_after_epoch).is_none());
        assert!(doc.get_first(engine.fields.staleness_classified).is_none());
        assert!(doc.get_first(engine.fields.trust_tier).is_none());
        assert!(doc.get_first(engine.fields.conformance).is_some());
    }
}
