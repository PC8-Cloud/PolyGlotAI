/** Extract plain text from uploaded files (.txt, .pdf, .docx, .doc, .md) */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;

  // PDF
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      pages.push(pageText);
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

  // DOC (old format) — try as text, won't always work but better than nothing
  if (type === "application/msword" || name.endsWith(".doc")) {
    const mammoth = await import("mammoth");
    const buffer = await file.arrayBuffer();
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value;
    } catch {
      // Fallback to raw text
      return await file.text();
    }
  }

  // Plain text (.txt, .md, etc.)
  return await file.text();
}
