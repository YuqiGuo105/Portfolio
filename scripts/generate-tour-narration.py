#!/usr/bin/env python3
"""Record the Vibe Guide narration (public/assets/audio/tour/<version>/{en,zh}/<chapter>.mp3).

The lines come from src/lib/tourNarrative.mjs (narrationScript), so the audio always says what the tour shows.
Voices: Kokoro 82M through sherpa-onnx, af_heart for English and zf_039 for Mandarin, then two-pass EBU R128
loudness normalisation to -16 LUFS and 24 kHz mono 64 kbps MP3. A manifest.json next to the files records the
exact text of each recording; tests/tour-narrative.test.mjs fails when the copy changes without a re-record.

Setup (once):
  pip install sherpa-onnx soundfile numpy        # ffmpeg and node must be on PATH
  export TOUR_TTS_MODELS=/path/to/models          # holds the two unpacked model folders below:
    https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2
    https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2
Run from the repository root:  python3 scripts/generate-tour-narration.py
"""
import json, os, subprocess, sys, tempfile

import numpy as np
import sherpa_onnx
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.environ.get("TOUR_TTS_MODELS", os.path.join(ROOT, ".tts-models"))
# language: (model folder, speaker id, speed). Speaker ids follow the sherpa-onnx Kokoro speaker tables.
VOICES = {"en": ("kokoro-multi-lang-v1_0", 3, 0.92, "af_heart"), "zh": ("kokoro-multi-lang-v1_1", 24, 0.98, "zf_039")}
# Words the bundled English lexicon lacks (sherpa-onnx skips unknown words); "Yuqi" is read "YOO-chee".
EXTRA_LEXICON = """yuqi j ˈ u ʧ i
yuqi's j ˈ u ʧ i z
cv s ˌ i v ˈ i
catches k ˈ æ ʧ ᵻ z
opens ˈ O p ᵊ n z
screenshots s k ɹ ˈ i n ʃ ˌ ɑ t s
services s ˈ ɜ ɹ v ə s ᵻ z
"""


def engine(folder, lexicons):
    model = os.path.join(MODELS, folder)
    paths = ",".join(item if os.path.isabs(item) else os.path.join(model, item) for item in lexicons)
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=f"{model}/model.onnx", voices=f"{model}/voices.bin", tokens=f"{model}/tokens.txt",
                data_dir=f"{model}/espeak-ng-data", dict_dir=f"{model}/dict", lexicon=paths, lang=""),
            num_threads=4, provider="cpu"),
        rule_fsts=f"{model}/date-zh.fst,{model}/phone-zh.fst,{model}/number-zh.fst",
        max_num_sentences=1)
    return sherpa_onnx.OfflineTts(config)


def to_mp3(wav, mp3):
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                            "-f", "null", "-"], capture_output=True, text=True).stderr
    stats = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    loudnorm = ("loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:"
                "measured_thresh={input_thresh}:offset={target_offset}:linear=true").format(**stats)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-af", loudnorm, "-ar", "24000", "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "64k", "-map_metadata", "-1", "-id3v2_version", "0", mp3], check=True)


def main():
    exported = subprocess.run(
        ["node", "--input-type=module", "-e",
         "const m = await import('./src/lib/tourNarrative.mjs'); console.log(JSON.stringify({ version: m.NARRATION_VERSION, script: m.narrationScript() }))"],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout
    data = json.loads(exported)
    out = os.path.join(ROOT, "public", "assets", "audio", "tour", data["version"])
    only = set(sys.argv[1:]) or set(data["script"])
    with tempfile.TemporaryDirectory() as scratch:
        extra = os.path.join(scratch, "extra-en.txt")
        with open(extra, "w", encoding="utf-8") as handle:
            handle.write(EXTRA_LEXICON)
        manifest_path = os.path.join(out, "manifest.json")
        manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {"chapters": {}}
        for language, lines in data["script"].items():
            if language not in only:
                continue
            folder, speaker, speed, voice = VOICES[language]
            tts = engine(folder, [extra, "lexicon-us-en.txt", "lexicon-zh.txt"] if language == "en" else ["lexicon-zh.txt", "lexicon-us-en.txt"])
            os.makedirs(os.path.join(out, language), exist_ok=True)
            entries = manifest["chapters"].setdefault(language, {})
            for chapter, text in lines.items():
                audio = tts.generate(text, sid=speaker, speed=speed)
                rate = audio.sample_rate
                samples = np.concatenate([np.zeros(int(rate * 0.12), np.float32), np.array(audio.samples, np.float32),
                                          np.zeros(int(rate * 0.35), np.float32)])
                wav = os.path.join(scratch, f"{language}-{chapter}.wav")
                sf.write(wav, samples, rate)
                to_mp3(wav, os.path.join(out, language, f"{chapter}.mp3"))
                entries[chapter] = {"text": text, "seconds": round(len(samples) / rate, 2)}
                print(f"{language}/{chapter}.mp3  {entries[chapter]['seconds']} s", flush=True)
            manifest.setdefault("voices", {})[language] = f"Kokoro 82M ({folder}) {voice}, speed {speed}"
        manifest["version"] = data["version"]
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
            handle.write("\n")


if __name__ == "__main__":
    main()
