import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TestBundle {
  root: string;
  cleanup(): Promise<void>;
}

export async function createBundle(
  files: Record<string, string | Uint8Array>,
): Promise<TestBundle> {
  const root = await mkdtemp(
    join(tmpdir(), "okf-minisearch-"),
  );

  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), {
      recursive: true,
    });
    await writeFile(absolutePath, contents);
  }

  return {
    root,
    cleanup: () => rm(root, {
      recursive: true,
      force: true,
    }),
  };
}

export function concept(
  metadata: string,
  body = "boundaryneedle",
): string {
  const lines = metadata.split("\n");

  while (!lines[0]?.trim()) lines.shift();
  while (!lines.at(-1)?.trim()) lines.pop();

  const indentation = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => line.match(/^\s*/)?.[0].length ?? 0),
  );
  const yaml = lines
    .map((line) => line.slice(indentation))
    .join("\n");

  return `---\n${yaml}\n---\n${body}`;
}
