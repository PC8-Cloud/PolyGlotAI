import { useState, useEffect, useCallback, useRef } from "react";
import { getLocaleForCode } from "../lib/languages";
import { suspendAudioForMic } from "../lib/openai";

export function useSpeechRecognition(language: string = "en") {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [recognition, setRecognition] = useState<any>(null);
  const recognitionRef = useRef<any>(null);
  const stopRequestedRef = useRef(false);
  const micAccessPrimedRef = useRef(false);

  const ensureMicrophoneAccess = useCallback(async () => {
    if (micAccessPrimedRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    micAccessPrimedRef.current = true;
    return true;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          recognitionRef.current?.abort?.();
        } catch {}
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = getLocaleForCode(language);

        rec.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);
        };

        rec.onstart = () => {
          stopRequestedRef.current = false;
          setIsListening(true);
        };

        rec.onerror = (event: any) => {
          console.warn("Speech recognition error", event.error);
          setIsListening(false);
        };

        rec.onend = () => {
          if (stopRequestedRef.current) {
            stopRequestedRef.current = false;
          }
          setIsListening(false);
        };

        recognitionRef.current = rec;
        setRecognition(rec);
      } else {
        console.warn("Speech recognition not supported in this browser.");
      }
    }

    return () => {
      try {
        recognitionRef.current?.abort?.();
      } catch {}
      recognitionRef.current = null;
    };
  }, [language]);

  const startListening = useCallback(async () => {
    if (recognition && !isListening) {
      try {
        await ensureMicrophoneAccess();
        suspendAudioForMic();
        stopRequestedRef.current = false;
        setTranscript("");
        recognition.start();
      } catch (e) {
        console.warn(e);
        setIsListening(false);
      }
    }
  }, [recognition, isListening, ensureMicrophoneAccess]);

  const stopListening = useCallback(() => {
    if (recognition) {
      stopRequestedRef.current = true;
      try {
        recognition.stop();
      } catch (e) {
        console.warn(e);
      }
      setIsListening(false);
    }
  }, [recognition]);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    setTranscript,
    supported: !!recognition,
  };
}
