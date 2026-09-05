import { readFile as readBinaryFile, stat } from "node:fs/promises";
import { extname, basename } from "node:path";

import { sliceText } from "../slice.js";

export type ReadFileOptions = {
  baseUrl: string;
  path: string;
  skip?: number;
  length?: number;
  engine?: "auto" | "direct" | "browser";
  timeout?: number;
};

const MIME_TYPES: Record<string, string> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".htm": "text/html",
  ".html": "text/html",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function readFile(options: ReadFileOptions): Promise<string> {
  const fileStat = await stat(options.path);
  if (!fileStat.isFile()) throw new Error("read_file 的 path 必须是本地文件");

  const filename = basename(options.path);
  const contentType = MIME_TYPES[extname(filename).toLowerCase()] || "application/octet-stream";
  const blob = new Blob([await readBinaryFile(options.path)], { type: contentType });
  const formData = new FormData();
  formData.set("file", new File([blob], filename, { type: contentType }));

  const endpoint = new URL("/read/", options.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-engine": options.engine || "auto",
      "x-retain-images": "all",
      "x-retain-links": "all",
    },
    body: formData,
    signal: AbortSignal.timeout((options.timeout ?? 90) * 1000),
  });
  if (!response.ok) throw new Error(`jina reader 返回 HTTP ${response.status}`);

  return sliceText(await response.text(), options.skip, options.length);
}
