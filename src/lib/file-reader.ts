import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** Extract plain text from uploaded files (.txt, .pdf, .docx, .doc, .md) */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;

  // PDF
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      if (pageText.trim()) pages.push(pageText);
    }
    return pages.join("\n\n");
  }

  // DOCX
  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  // DOC (old format)
  if (type === "application/msword" || name.endsWith(".doc")) {
    try {
      const mammoth = await import("mammoth");
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value;
    } catch {
      return await file.text();
    }
  }

  // Plain text (.txt, .md, etc.)
  return await file.text();
}
