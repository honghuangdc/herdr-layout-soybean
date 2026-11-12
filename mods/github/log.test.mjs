// node mods/github/log.test.mjs [a log from `gh run view <id> --log-failed`]
import { trimLog } from "./log.js";
import { readFileSync } from "fs";
import assert from "assert";

const line = (text) => `build\tstep\t2026-11-02T16:08:21.9539234Z ${text}`;
const sample = [
  line("\x1b[36;1mecho hi\x1b[0m"), line("##[group]Run lychee"), line("  INPUT_FAIL: true"),
  ...Array.from({ length: 200 }, (_, n) => line(`checking link ${n}`)),
  line("* [ERROR] <file:///docs/guide> (at 166:16) | File not found"),
  line("##[error]Process completed with exit code 2."),
  line("git version 2.56.0"),
].join("\n");

const out = trimLog(process.argv[2] ? readFileSync(process.argv[2], "utf8") : sample);
assert(out.includes("[ERROR]"), "keeps the error lines");
assert(out.includes("exit code 2"), "keeps the exit line");
assert(!/\x1b|##\[group\]|INPUT_FAIL/.test(out), "drops colors and runner noise");
assert(out.split("\n").length <= 80, "at most 80 lines");
assert.equal(trimLog(""), "", "empty log");
assert(trimLog(line("hello")).endsWith("| hello"), "no error: keeps the tail");
console.log("log.test ok:", out.split("\n").length, "lines");
