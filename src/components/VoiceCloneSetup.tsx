import { useState, useRef, useCallback } from "react";
import { Mic, Square, Check, AlertCircle, Trash2, Loader2 } from "lucide-react";
import { useUserStore } from "../lib/store";
import { createOpenAIVoiceConsent, createOpenAICustomVoice } from "../lib/openai";

type Step = "idle" | "consent" | "sample" | "creating" | "done";

const CONSENT_TEXT: Record<string, string> = {
  it: "Io autorizzo l'uso della mia voce per generare una voce sintetica che può essere usata in applicazioni vocali. Questa registrazione viene usata esclusivamente per creare il mio profilo vocale personale.",
  en: "I authorize the use of my voice to generate a synthetic voice that can be used in voice applications. This recording is used exclusively to create my personal voice profile.",
  es: "Autorizo el uso de mi voz para generar una voz sintética que pueda ser utilizada en aplicaciones de voz. Esta grabación se utiliza exclusivamente para crear mi perfil de voz personal.",
  fr: "J'autorise l'utilisation de ma voix pour générer une voix synthétique pouvant être utilisée dans des applications vocales. Cet enregistrement est utilisé exclusivement pour créer mon profil vocal personnel.",
  de: "Ich genehmige die Nutzung meiner Stimme zur Erzeugung einer synthetischen Stimme, die in Sprachanwendungen verwendet werden kann. Diese Aufnahme wird ausschließlich zur Erstellung meines persönlichen Stimmprofils verwendet.",
};

const SAMPLE_TEXT: Record<string, string> = {
  it: "Buongiorno, benvenuti a Roma. Oggi vi accompagnerò alla scoperta dei luoghi più affascinanti della città eterna. Passeremo per il Colosseo, il Foro Romano e piazza Navona. Se avete domande, non esitate a chiedere. Sarà una giornata meravigliosa.",
  en: "Good morning, welcome to Rome. Today I will guide you through the most fascinating places of the eternal city. We will walk by the Colosseum, the Roman Forum and Piazza Navona. If you have any questions, please don't hesitate to ask. It will be a wonderful day.",
  es: "Buenos días, bienvenidos a Roma. Hoy les acompañaré por los lugares más fascinantes de la ciudad eterna. Pasaremos por el Coliseo, el Foro Romano y la Piazza Navona. Si tienen preguntas, no duden en preguntar. Será un día maravilloso.",
  fr: "Bonjour, bienvenue à Rome. Aujourd'hui je vous guiderai à travers les lieux les plus fascinants de la ville éternelle. Nous passerons par le Colisée, le Forum Romain et la Piazza Navona. Si vous avez des questions, n'hésitez pas à demander. Ce sera une journée merveilleuse.",
  de: "Guten Morgen, willkommen in Rom. Heute führe ich Sie durch die faszinierendsten Orte der ewigen Stadt. Wir kommen am Kolosseum, dem Forum Romanum und der Piazza Navona vorbei. Wenn Sie Fragen haben, zögern Sie nicht zu fragen. Es wird ein wundervoller Tag.",
};

function getLangBase(lang: string): string {
  return String(lang || "en").toLowerCase().split("-")[0];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result); // returns data:audio/...;base64,...
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface Props {
  onClose: () => void;
}

export default function VoiceCloneSetup({ onClose }: Props) {
  const { uiLanguage, userName, customVoiceId, customVoiceName, setCustomVoice } = useUserStore();
  const lang = getLangBase(uiLanguage);
  const isIt = lang === "it";

  const [step, setStep] = useState<Step>(customVoiceId ? "done" : "idle");
  const [recording, setRecording] = useState(false);
  const [consentAudio, setConsentAudio] = useState<Blob | null>(null);
  const [sampleAudio, setSampleAudio] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const consentText = CONSENT_TEXT[lang] || CONSENT_TEXT.en;
  const sampleText = SAMPLE_TEXT[lang] || SAMPLE_TEXT.en;

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError(isIt ? "Accesso al microfono negato" : "Microphone access denied");
    }
  }, [isIt]);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        resolve(new Blob());
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        resolve(blob);
      };
      recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      setRecording(false);
    });
  }, []);

  const handleConsentRecord = async () => {
    if (recording) {
      const blob = await stopRecording();
      if (blob.size < 5000) {
        setError(isIt ? "Registrazione troppo breve, riprova" : "Recording too short, try again");
        return;
      }
      setConsentAudio(blob);
    } else {
      await startRecording();
    }
  };

  const handleSampleRecord = async () => {
    if (recording) {
      const blob = await stopRecording();
      if (blob.size < 10000) {
        setError(isIt ? "Registrazione troppo breve, leggi tutto il testo" : "Recording too short, read the full text");
        return;
      }
      setSampleAudio(blob);
    } else {
      await startRecording();
    }
  };

  const handleCreate = async () => {
    if (!consentAudio || !sampleAudio) return;
    setStep("creating");
    setError(null);
    const voiceName = userName ? `${userName}_polyglot` : `voice_${Date.now()}`;

    try {
      setProgress(isIt ? "Invio consenso vocale..." : "Uploading voice consent...");
      const consentBase64 = await blobToBase64(consentAudio);
      const consent = await createOpenAIVoiceConsent(voiceName, lang, consentBase64);

      setProgress(isIt ? "Creazione voce personalizzata..." : "Creating custom voice...");
      const sampleBase64 = await blobToBase64(sampleAudio);
      const voice = await createOpenAICustomVoice(voiceName, consent.id, sampleBase64);

      setCustomVoice(voice.id, voiceName);
      setStep("done");
      setProgress("");
    } catch (e: any) {
      setError(e?.message || (isIt ? "Errore nella creazione della voce" : "Voice creation failed"));
      setStep("sample");
      setProgress("");
    }
  };

  const handleRemove = () => {
    setCustomVoice(null, null);
    setConsentAudio(null);
    setSampleAudio(null);
    setStep("idle");
  };

  // ── Done state ──
  if (step === "done" && customVoiceId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-green-500/10 border border-green-500/30">
          <Check className="w-6 h-6 text-green-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-green-300">
              {isIt ? "Voce personalizzata attiva" : "Custom voice active"}
            </p>
            <p className="text-xs text-green-300/60 mt-0.5 truncate">
              {customVoiceName || customVoiceId}
            </p>
          </div>
        </div>
        <p className="text-xs text-[#F4F4F4]/50">
          {isIt
            ? "La tua voce clonata viene usata automaticamente per tutte le riproduzioni vocali nell'app."
            : "Your cloned voice is automatically used for all voice playback in the app."}
        </p>
        <button
          onClick={handleRemove}
          className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {isIt ? "Rimuovi voce personalizzata" : "Remove custom voice"}
        </button>
      </div>
    );
  }

  // ── Creating state ──
  if (step === "creating") {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <Loader2 className="w-10 h-10 text-[#295BDB] animate-spin" />
        <p className="text-sm text-[#F4F4F4]/70">{progress}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Step 1: Consent */}
      <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${
        step === "consent" || (!consentAudio && step === "idle")
          ? "border-[#295BDB]/50 bg-[#295BDB]/5"
          : consentAudio
            ? "border-green-500/30 bg-green-500/5"
            : "border-[#FFFFFF14] bg-[#0E2666]/50"
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            consentAudio ? "bg-green-500 text-white" : "bg-[#295BDB] text-white"
          }`}>
            {consentAudio ? <Check className="w-3.5 h-3.5" /> : "1"}
          </div>
          <p className="text-sm font-bold">
            {isIt ? "Consenso vocale" : "Voice consent"}
          </p>
        </div>
        <p className="text-xs text-[#F4F4F4]/50">
          {isIt ? "Leggi ad alta voce il testo qui sotto:" : "Read the following text aloud:"}
        </p>
        <div className="rounded-xl bg-[#02114A]/60 border border-[#FFFFFF14] p-3">
          <p className="text-xs text-[#F4F4F4]/80 italic leading-relaxed">{consentText}</p>
        </div>
        {!consentAudio && (
          <button
            onClick={() => { setStep("consent"); handleConsentRecord(); }}
            className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
              recording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-[#295BDB] text-white hover:bg-[#295BDB]/80"
            }`}
          >
            {recording ? (
              <><Square className="w-4 h-4" /> {isIt ? "Ferma registrazione" : "Stop recording"}</>
            ) : (
              <><Mic className="w-4 h-4" /> {isIt ? "Registra consenso" : "Record consent"}</>
            )}
          </button>
        )}
        {consentAudio && !recording && (
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-300">{isIt ? "Consenso registrato" : "Consent recorded"}</span>
            <button
              onClick={() => { setConsentAudio(null); setStep("idle"); }}
              className="ml-auto text-xs text-[#F4F4F4]/40 hover:text-[#F4F4F4]"
            >
              {isIt ? "Ripeti" : "Redo"}
            </button>
          </div>
        )}
      </div>

      {/* Step 2: Voice sample */}
      <div className={`rounded-2xl border p-4 space-y-3 transition-colors ${
        step === "sample" || (consentAudio && !sampleAudio)
          ? "border-[#295BDB]/50 bg-[#295BDB]/5"
          : sampleAudio
            ? "border-green-500/30 bg-green-500/5"
            : "border-[#FFFFFF14] bg-[#0E2666]/30 opacity-50"
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            sampleAudio ? "bg-green-500 text-white" : "bg-[#295BDB] text-white"
          }`}>
            {sampleAudio ? <Check className="w-3.5 h-3.5" /> : "2"}
          </div>
          <p className="text-sm font-bold">
            {isIt ? "Campione vocale" : "Voice sample"}
          </p>
        </div>
        <p className="text-xs text-[#F4F4F4]/50">
          {isIt
            ? "Leggi questo testo con voce chiara e naturale:"
            : "Read this text clearly and naturally:"}
        </p>
        <div className="rounded-xl bg-[#02114A]/60 border border-[#FFFFFF14] p-3">
          <p className="text-xs text-[#F4F4F4]/80 italic leading-relaxed">{sampleText}</p>
        </div>
        {consentAudio && !sampleAudio && (
          <button
            onClick={() => { setStep("sample"); handleSampleRecord(); }}
            className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
              recording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-[#295BDB] text-white hover:bg-[#295BDB]/80"
            }`}
          >
            {recording ? (
              <><Square className="w-4 h-4" /> {isIt ? "Ferma registrazione" : "Stop recording"}</>
            ) : (
              <><Mic className="w-4 h-4" /> {isIt ? "Registra campione" : "Record sample"}</>
            )}
          </button>
        )}
        {sampleAudio && !recording && (
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-300">{isIt ? "Campione registrato" : "Sample recorded"}</span>
            <button
              onClick={() => { setSampleAudio(null); setStep("sample"); }}
              className="ml-auto text-xs text-[#F4F4F4]/40 hover:text-[#F4F4F4]"
            >
              {isIt ? "Ripeti" : "Redo"}
            </button>
          </div>
        )}
      </div>

      {/* Create button */}
      {consentAudio && sampleAudio && (
        <button
          onClick={handleCreate}
          className="w-full py-3 rounded-xl bg-[#295BDB] hover:bg-[#295BDB]/80 text-white font-bold text-sm transition-colors"
        >
          {isIt ? "Crea la mia voce" : "Create my voice"}
        </button>
      )}
    </div>
  );
}
