import React, { useState, useRef } from "react";
import { X, Upload, ClipboardPaste, FileText } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import { useUserStore } from "../lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (text: string) => void;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(" ");
    pages.push(text);
  }
  return pages.join("\n\n");
}

export default function LoadTextModal({ open, onClose, onLoad }: Props) {
  const { uiLanguage } = useUserStore();
  const t = useTranslation(uiLanguage);
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");

    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }

      if (!text.trim()) {
        setError(t("loadTextEmpty"));
        return;
      }
      onLoad(text.trim());
      setPasteText("");
      onClose();
    } catch (e: any) {
      console.error("File read error:", e);
      setError(t("loadTextError"));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    onLoad(pasteText.trim());
    setPasteText("");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0E2666] rounded-3xl max-w-sm w-full border border-[#FFFFFF14] flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#FFFFFF14]">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#295BDB]" />
            {t("loadText")}
          </h2>
          <button onClick={onClose} className="text-[#F4F4F4]/60 hover:text-[#F4F4F4]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* File upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.md,.text"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-4 bg-[#295BDB] hover:bg-[#295BDB]/80 disabled:opacity-50 rounded-xl font-medium transition-colors"
            >
              <Upload className="w-5 h-5" />
              {loading ? "..." : t("loadTextFile")}
            </button>
            <p className="text-xs text-[#F4F4F4]/60 text-center mt-1.5">.txt, .pdf</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-[#FFFFFF14]" />
            <span className="text-xs text-[#F4F4F4]/60">{t("or")}</span>
            <div className="flex-1 border-t border-[#FFFFFF14]" />
          </div>

          {/* Paste area */}
          <div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={t("loadTextPaste")}
              rows={5}
              className="w-full bg-[#02114A] border border-[#FFFFFF14] rounded-xl px-4 py-3 text-[#F4F4F4] placeholder-[#F4F4F4]/30 focus:ring-2 focus:ring-[#295BDB] outline-none text-sm resize-none"
            />
            <button
              onClick={handlePaste}
              disabled={!pasteText.trim()}
              className="w-full mt-2 flex items-center justify-center gap-2 py-3 bg-[#123182] hover:bg-[#123182]/80 disabled:opacity-40 rounded-xl font-medium transition-colors text-sm"
            >
              <ClipboardPaste className="w-4 h-4" />
              {t("loadTextUse")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
