import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI, { toFile } from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  api: {
    bodyParser: false, // We handle raw body for file upload
  },
};

function parseBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const rawBody = await parseBody(req);

    // Parse multipart form data manually (simple parser for single file + fields)
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) return res.status(400).json({ error: "No boundary" });

      const boundary = boundaryMatch[1];
      const parts = parseMultipart(rawBody, boundary);

      const filePart = parts.find((p) => p.name === "file");
      const languagePart = parts.find((p) => p.name === "language");
      const modelPart = parts.find((p) => p.name === "model");

      if (!filePart?.data) return res.status(400).json({ error: "No audio file" });

      const language = languagePart?.data?.toString() || undefined;
      const model = modelPart?.data?.toString() || "gpt-4o-transcribe";

      const file = await toFile(filePart.data, filePart.filename || "audio.webm", {
        type: filePart.contentType || "audio/webm",
      });

      const response = await client.audio.transcriptions.create({
        model,
        file,
        ...(language && language !== "auto" ? { language } : {}),
      });

      return res.json({ text: response.text });
    }

    return res.status(400).json({ error: "Expected multipart/form-data" });
  } catch (err: any) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || "Transcription failed", status });
  }
}

interface MultipartPart {
  name?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBuf = Buffer.from(`--${boundary}--`);

  let start = body.indexOf(boundaryBuf) + boundaryBuf.length;

  while (start < body.length) {
    const nextBoundary = body.indexOf(boundaryBuf, start);
    if (nextBoundary === -1) break;

    const partData = body.subarray(start, nextBoundary);
    const headerEnd = partData.indexOf("\r\n\r\n");
    if (headerEnd === -1) { start = nextBoundary + boundaryBuf.length; continue; }

    const headerStr = partData.subarray(0, headerEnd).toString();
    const data = partData.subarray(headerEnd + 4, partData.length - 2); // trim trailing \r\n

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    parts.push({
      name: nameMatch?.[1],
      filename: filenameMatch?.[1],
      contentType: ctMatch?.[1]?.trim(),
      data,
    });

    start = nextBoundary + boundaryBuf.length;
    if (body.subarray(nextBoundary, nextBoundary + endBuf.length).equals(endBuf)) break;
  }

  return parts;
}
