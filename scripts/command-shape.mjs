const BATCH_SHIM = /\.(?:cmd|bat)$/i

export function resolveCommandShape(command, args, {
  platform = process.platform,
  comSpec = process.env.ComSpec,
} = {}) {
  if (platform === "win32" && BATCH_SHIM.test(command)) {
    return {
      command: comSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    }
  }
  return { command, args: [...args] }
}
