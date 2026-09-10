#!/usr/bin/env python3
"""Frame real app recordings, add narration/captions, and build a local player.

Only generated presentation assets are written. Raw browser captures and source
narration are never modified. No screen recording or browser control occurs here.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import math
import re
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont


@dataclass(frozen=True)
class RenderSettings:
    width: int = 1920
    height: int = 1080
    fps: int = 30
    audio_offset: float = 0.35
    minimum_tail: float = 0.65
    crf: int = 20
    preset: str = "veryfast"
    background: str = "#e9ece7"
    ink: str = "#232a24"
    muted: str = "#64715f"
    accent: str = "#2e49ef"
    desktop_box: tuple[int, int, int, int] = (160, 90, 1600, 900)
    mobile_box: tuple[int, int, int, int] = (1130, 118, 390, 844)


@dataclass
class Segment:
    id: str
    title: str
    perspective: str
    narration: str
    audio_path: Path
    raw_path: Path
    declared_audio_duration: float
    index: int
    mobile: bool = False
    audio_duration: float = 0
    raw_duration: float = 0
    duration: float = 0
    start: float = 0

    @classmethod
    def from_plan(cls, value: dict[str, Any], directory: Path, index: int) -> "Segment":
        identifier = value["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
            raise ValueError(f"Unsafe segment identifier: {identifier!r}")
        return cls(
            id=identifier,
            title=value["title"],
            perspective=value["perspective"],
            narration=value.get("narration", ""),
            audio_path=(directory / value["audioPath"]).resolve(),
            raw_path=directory / "raw" / f"{identifier}.webm",
            declared_audio_duration=float(value["durationSeconds"]),
            index=index,
            mobile=identifier.startswith("12-") or bool(value.get("mobile")),
        )

    def chapter(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "number": self.index,
            "title": self.title,
            "perspective": self.perspective,
            "startSeconds": round(self.start, 6),
            "durationSeconds": round(self.duration, 6),
            "endSeconds": round(self.start + self.duration, 6),
            "narrationStartsAt": round(self.start + 0.35, 6),
            "narrationDurationSeconds": round(self.audio_duration, 6),
            "rawDurationSeconds": round(self.raw_duration, 6),
            "narration": self.narration,
        }


class MediaTools:
    @staticmethod
    def run(arguments: list[str], *, capture: bool = False) -> str:
        result = subprocess.run(arguments, text=True, stdout=subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE, check=False)
        if result.returncode:
            raise RuntimeError(f"Command failed: {arguments[0]}\n{result.stderr[-12000:]}")
        return result.stdout or ""

    @classmethod
    def probe(cls, path: Path) -> dict[str, Any]:
        return json.loads(cls.run([
            "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)
        ], capture=True))

    @staticmethod
    def duration(probe: dict[str, Any], kind: str | None = None) -> float:
        if kind:
            stream = next((item for item in probe.get("streams", []) if item.get("codec_type") == kind), {})
            if stream.get("duration") not in (None, "N/A"):
                return float(stream["duration"])
        value = probe.get("format", {}).get("duration")
        if value in (None, "N/A"):
            raise ValueError("The media file has no finite duration.")
        return float(value)

    @staticmethod
    def write_if_changed(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)


class FrameDesigner:
    """Draw the presentation outside a transparent, unmodified app viewport."""

    def __init__(self, settings: RenderSettings):
        self.settings = settings
        self.font_file = Path("/System/Library/Fonts/Avenir Next.ttc")
        if not self.font_file.exists():
            self.font_file = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        self._fonts: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}

    def font(self, size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
        key = size, bold
        if key not in self._fonts:
            index = (2 if bold else 7) if self.font_file.suffix == ".ttc" else 0
            self._fonts[key] = ImageFont.truetype(str(self.font_file), size, index=index)
        return self._fonts[key]

    def fit_font(self, text: str, size: int, width: int, bold: bool = False) -> ImageFont.FreeTypeFont:
        font = self.font(size, bold)
        while font.getlength(text) > width and size > 12:
            size -= 1
            font = self.font(size, bold)
        return font

    def logo(self, draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
        color = self.settings.accent
        draw.line([(x, y + 27), (x, y + 2), (x + 12, y + 2)], fill=color, width=4)
        draw.arc((x + 2, y + 2, x + 23, y + 18), -90, 90, fill=color, width=4)
        draw.line([(x + 12, y + 18), (x, y + 18)], fill=color, width=4)
        draw.line([(x + 10, y + 18), (x + 22, y + 29)], fill=color, width=4)
        draw.line([(x + 28, y + 1), (x + 28, y + 29)], fill=color, width=4)
        draw.line([(x, y + 27), (x + 10, y + 18)], fill=color, width=4)

    def build(self, segment: Segment, total: int, path: Path) -> None:
        cfg = self.settings
        image = Image.new("RGBA", (cfg.width, cfg.height), cfg.background)
        draw = ImageDraw.Draw(image)
        self.logo(draw, 160, 29)
        draw.text((206, 24), "RobinHacks", fill=cfg.ink, font=self.font(29, True))
        draw.text((407, 35), "PRODUCT WALKTHROUGH", fill=cfg.muted, font=self.font(13, True))
        disclosure = "(fictional sample event)"
        disclosure_font = self.font(14)
        draw.text((920 - disclosure_font.getlength(disclosure) / 2, 34), disclosure,
                  fill=cfg.muted, font=disclosure_font)
        pill_font = self.fit_font(segment.perspective, 18, 500)
        pill_width = math.ceil(pill_font.getlength(segment.perspective)) + 48
        pill_x = 1760 - pill_width
        draw.rounded_rectangle((pill_x, 23, 1760, 65), radius=21,
                               fill="#f6f7f3", outline="#d5dccf", width=1)
        draw.ellipse((pill_x + 17, 40, pill_x + 23, 46), fill=cfg.accent)
        draw.text((pill_x + 32, 30), segment.perspective, fill=cfg.ink, font=pill_font)

        if segment.mobile:
            image = self._mobile(image)
            box = cfg.mobile_box
        else:
            image = self._desktop(image)
            box = cfg.desktop_box
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((160, 1030, 190, 1033), radius=2, fill=cfg.accent)
        title_font = self.fit_font(segment.title, 24, 1260, True)
        draw.text((208, 1014), segment.title, fill=cfg.ink, font=title_font)
        count = f"{segment.index:02d} / {total:02d}"
        draw.text((1760 - self.font(17).getlength(count), 1021), count,
                  fill=cfg.muted, font=self.font(17))
        # Keep every source pixel in the aperture, including its square corners.
        x, y, width, height = box
        draw.rectangle((x, y, x + width - 1, y + height - 1), fill=(0, 0, 0, 0))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        MediaTools.write_if_changed(path, buffer.getvalue())

    def _desktop(self, image: Image.Image) -> Image.Image:
        x, y, width, height = self.settings.desktop_box
        shadow = Image.new("RGBA", image.size)
        draw = ImageDraw.Draw(shadow)
        draw.rounded_rectangle((x - 3, y + 7, x + width + 3, y + height + 11),
                               radius=12, fill=(28, 39, 26, 31))
        image = Image.alpha_composite(image, shadow.filter(ImageFilter.GaussianBlur(15)))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((x - 2, y - 2, x + width + 1, y + height + 1),
                               radius=4, fill="#fbfcf9", outline="#c6cec0", width=1)
        return image

    def _mobile(self, image: Image.Image) -> Image.Image:
        cfg = self.settings
        draw = ImageDraw.Draw(image)
        draw.text((244, 188), "ON A PHONE", fill=cfg.accent, font=self.font(16, True))
        draw.text((240, 231), "Mobile,", fill=cfg.ink, font=self.font(74, True))
        draw.text((240, 320), "same market.", fill=cfg.ink, font=self.font(74, True))
        draw.text((245, 436), "Alex Chen · Mosaic captain", fill=cfg.muted, font=self.font(23))
        facts = [
            ("Bottom navigation", "Explore, Portfolio, Standings, and Team."),
            ("One shared portfolio", "The same holdings and notes on every device."),
            ("Fresh trade quotes", "Review the exact total before confirming."),
        ]
        for index, (title, detail) in enumerate(facts):
            top = 560 + index * 115
            draw.ellipse((245, top + 1, 278, top + 34), fill="#dce3fa")
            label = str(index + 1)
            draw.text((255, top + 4), label, fill=cfg.accent, font=self.font(16, True))
            draw.text((300, top - 3), title, fill=cfg.ink, font=self.font(24, True))
            draw.text((300, top + 35), detail, fill=cfg.muted, font=self.font(18))
        draw.text((245, 933), "Actual mobile viewport · 390 × 844", fill=cfg.muted, font=self.font(15))
        x, y, width, height = cfg.mobile_box
        shadow = Image.new("RGBA", image.size)
        shadow_draw = ImageDraw.Draw(shadow)
        shadow_draw.rounded_rectangle((x - 17, y - 14, x + width + 21, y + height + 25),
                                      radius=39, fill=(21, 34, 19, 62))
        image = Image.alpha_composite(image, shadow.filter(ImageFilter.GaussianBlur(22)))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((x - 16, y - 20, x + width + 16, y + height + 20),
                               radius=38, fill="#29302b", outline="#515a4f", width=2)
        draw.rounded_rectangle((x + 154, y - 11, x + 236, y - 6), radius=3, fill="#111a13")
        draw.rounded_rectangle((x + 147, y + height + 8, x + 243, y + height + 12),
                               radius=2, fill="#929d8e")
        draw.rounded_rectangle((x - 20, y + 130, x - 15, y + 190), radius=2, fill="#29302b")
        draw.rounded_rectangle((x + width + 15, y + 173, x + width + 20, y + 244),
                               radius=2, fill="#29302b")
        return image


class CaptionBuilder:
    def __init__(self, settings: RenderSettings):
        self.settings = settings

    @staticmethod
    def timestamp(seconds: float, separator: str = ",") -> str:
        milliseconds = max(0, round(seconds * 1000))
        hours, remainder = divmod(milliseconds, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        secs, millis = divmod(remainder, 1000)
        return f"{hours:02}:{minutes:02}:{secs:02}{separator}{millis:03}"

    @staticmethod
    def chunks(text: str) -> list[str]:
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        result: list[str] = []
        for sentence in sentences:
            words = sentence.split()
            chunk: list[str] = []
            for word in words:
                if chunk and (len(" ".join(chunk + [word])) > 86 or len(chunk) >= 15):
                    result.append(" ".join(chunk))
                    chunk = []
                chunk.append(word)
            if chunk:
                result.append(" ".join(chunk))
        return result

    def write(self, segments: list[Segment], directory: Path) -> list[dict[str, Any]]:
        cues: list[dict[str, Any]] = []
        for segment in segments:
            chunks = self.chunks(segment.narration)
            total_words = sum(len(item.split()) for item in chunks)
            consumed = 0
            for chunk in chunks:
                word_count = len(chunk.split())
                start = segment.start + self.settings.audio_offset + segment.audio_duration * consumed / total_words
                consumed += word_count
                end = segment.start + self.settings.audio_offset + segment.audio_duration * consumed / total_words
                cues.append({"start": start, "end": min(end, segment.start + segment.duration),
                             "text": textwrap.fill(chunk, width=44, break_long_words=False,
                                                   break_on_hyphens=False)})
        srt = []
        vtt = ["WEBVTT", ""]
        for index, cue in enumerate(cues, 1):
            srt.extend([str(index), f"{self.timestamp(cue['start'])} --> {self.timestamp(cue['end'])}", cue["text"], ""])
            vtt.extend([str(index), f"{self.timestamp(cue['start'], '.')} --> {self.timestamp(cue['end'], '.')}",
                        html.escape(cue["text"], quote=False), ""])
        (directory / "captions.srt").write_text("\n".join(srt), encoding="utf-8")
        (directory / "captions.vtt").write_text("\n".join(vtt), encoding="utf-8")
        (directory / "caption-timing.json").write_text(json.dumps({
            "method": "Sentence chunks, timed proportionally by word count within each measured narration file.",
            "narrationOffsetSeconds": self.settings.audio_offset, "cues": cues,
        }, indent=2), encoding="utf-8")
        return cues


class PlayerBuilder:
    @staticmethod
    def clock(seconds: float) -> str:
        minutes, secs = divmod(int(seconds), 60)
        return f"{minutes}:{secs:02d}"

    def write(self, segments: list[Segment], plan: dict[str, Any], directory: Path) -> None:
        duration = sum(segment.duration for segment in segments)
        buttons = []
        transcript = []
        transcript_text = [plan.get("title", "RobinHacks walkthrough"), "", plan.get("disclosure", ""), ""]
        for segment in segments:
            title = html.escape(segment.title)
            perspective = html.escape(segment.perspective)
            timestamp = self.clock(segment.start)
            buttons.append(f'<button class="chapter" data-start="{segment.start:.6f}" data-end="{segment.start + segment.duration:.6f}"><span class="chapter-time">{timestamp}</span><span><strong>{title}</strong><small>{perspective}</small></span><span class="chapter-number">{segment.index:02}</span></button>')
            transcript.append(f'<section><h3><time>{timestamp}</time>{title}</h3><p>{html.escape(segment.narration)}</p></section>')
            transcript_text.extend([f"{timestamp} — {segment.title}", segment.narration, ""])
        vtt = (directory / "captions.vtt").read_text(encoding="utf-8")
        embedded_vtt = json.dumps(vtt, ensure_ascii=False).replace("<", "\\u003c")
        page = PLAYER_TEMPLATE.replace("__TITLE__", html.escape(plan.get("title", "RobinHacks walkthrough")))
        page = page.replace("__DURATION__", self.clock(duration))
        page = page.replace("__CHAPTERS__", "\n".join(buttons))
        page = page.replace("__TRANSCRIPT__", "\n".join(transcript))
        page = page.replace("__VTT__", embedded_vtt)
        page = page.replace("__DISCLOSURE__", html.escape(plan.get("disclosure", "Recorded with fictional sample teams and credits.")))
        (directory / "index.html").write_text(page, encoding="utf-8")
        (directory / "transcript.txt").write_text("\n".join(transcript_text), encoding="utf-8")


class WalkthroughRenderer:
    def __init__(self, plan_path: Path, output: Path | None = None, settings: RenderSettings | None = None):
        self.plan_path = plan_path.resolve()
        self.source = self.plan_path.parent
        self.directory = (output or self.source).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.plan = json.loads(self.plan_path.read_text(encoding="utf-8"))
        self.settings = settings or RenderSettings()
        self.segments = [Segment.from_plan(value, self.source, index)
                         for index, value in enumerate(self.plan["segments"], 1)]
        if not self.segments:
            raise ValueError("The narration plan has no segments.")
        if len({segment.id for segment in self.segments}) != len(self.segments):
            raise ValueError("Segment IDs must be unique.")
        self.frames = self.directory / "frames"
        self.clips = self.directory / "rendered"
        self.frames.mkdir(exist_ok=True)
        self.clips.mkdir(exist_ok=True)

    def prepare_frames(self) -> None:
        designer = FrameDesigner(self.settings)
        for segment in self.segments:
            designer.build(segment, len(self.segments), self.frames / f"{segment.id}.png")
        print(f"Prepared {len(self.segments)} frames in {self.frames}", flush=True)

    def inspect_sources(self) -> None:
        missing = [str(path) for segment in self.segments
                   for path in [segment.audio_path, segment.raw_path] if not path.is_file()]
        if missing:
            raise FileNotFoundError("Source recordings are not ready:\n" + "\n".join(missing))
        for segment in self.segments:
            audio = MediaTools.probe(segment.audio_path)
            raw = MediaTools.probe(segment.raw_path)
            video_stream = next((stream for stream in raw["streams"] if stream.get("codec_type") == "video"), None)
            if not video_stream:
                raise ValueError(f"No video stream in {segment.raw_path}")
            _, _, width, height = self.settings.mobile_box if segment.mobile else self.settings.desktop_box
            actual_size = (video_stream.get("width"), video_stream.get("height"))
            if actual_size != (width, height):
                raise ValueError(f"{segment.id}: expected an unscaled {width}×{height} viewport, got {actual_size}. Re-record at the correct size; the renderer will not distort it.")
            segment.audio_duration = MediaTools.duration(audio, "audio")
            segment.raw_duration = MediaTools.duration(raw, "video")
            minimum = segment.audio_duration + self.settings.audio_offset + self.settings.minimum_tail
            segment.duration = math.ceil(max(segment.raw_duration, minimum) * self.settings.fps) / self.settings.fps
            if not (0 < segment.duration < 3600):
                raise ValueError(f"Implausible duration for {segment.id}: {segment.duration}")

    def render_clip(self, segment: Segment, *, force: bool = False) -> Path:
        cfg = self.settings
        target = self.clips / f"{segment.id}.mp4"
        frame = self.frames / f"{segment.id}.png"
        fingerprint = hashlib.sha256(json.dumps({
            "settings": asdict(cfg), "duration": segment.duration,
            "raw": [segment.raw_path.stat().st_size, segment.raw_path.stat().st_mtime_ns],
            "audio": [segment.audio_path.stat().st_size, segment.audio_path.stat().st_mtime_ns],
            "frame": hashlib.sha256(frame.read_bytes()).hexdigest(),
            "renderer": Path(__file__).stat().st_mtime_ns,
        }, sort_keys=True).encode()).hexdigest()
        cache = target.with_suffix(".json")
        if not force and target.exists() and cache.exists():
            info = json.loads(cache.read_text())
            if info.get("fingerprint") == fingerprint:
                segment.duration = MediaTools.duration(MediaTools.probe(target))
                print(f"Reused {segment.id} · {segment.duration:.2f}s", flush=True)
                return target
        x, y, _, _ = cfg.mobile_box if segment.mobile else cfg.desktop_box
        duration = f"{segment.duration:.6f}"
        filters = (
            f"[0:v]setpts=PTS-STARTPTS,fps={cfg.fps},tpad=stop_mode=clone:stop_duration={duration},"
            f"trim=duration={duration},pad={cfg.width}:{cfg.height}:{x}:{y}:color=black[app];"
            f"[app][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[video];"
            f"[2:a]aresample=48000,asetpts=PTS-STARTPTS,adelay={round(cfg.audio_offset * 1000)}:all=1,"
            f"apad,atrim=duration={duration}[audio]"
        )
        print(f"Rendering {segment.index:02}/{len(self.segments):02} {segment.id} · {segment.duration:.2f}s", flush=True)
        MediaTools.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(segment.raw_path), "-loop", "1", "-framerate", str(cfg.fps), "-i", str(frame),
            "-i", str(segment.audio_path), "-filter_complex", filters,
            "-map", "[video]", "-map", "[audio]", "-t", duration,
            "-c:v", "libx264", "-preset", cfg.preset, "-crf", str(cfg.crf),
            "-pix_fmt", "yuv420p", "-r", str(cfg.fps), "-video_track_timescale", "30000",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", str(target),
        ])
        segment.duration = MediaTools.duration(MediaTools.probe(target))
        cache.write_text(json.dumps({"fingerprint": fingerprint, "durationSeconds": segment.duration}, indent=2))
        return target

    @staticmethod
    def metadata_escape(value: str) -> str:
        return value.replace("\\", "\\\\").replace("=", "\\=").replace(";", "\\;").replace("#", "\\#").replace("\n", "\\\n")

    def write_metadata(self) -> Path:
        path = self.directory / "chapters.ffmetadata"
        lines = [";FFMETADATA1", "title=" + self.metadata_escape(self.plan.get("title", "RobinHacks walkthrough")),
                 "artist=RobinHacks", "comment=" + self.metadata_escape(self.plan.get("disclosure", "Fictional sample event"))]
        for segment in self.segments:
            lines.extend(["", "[CHAPTER]", "TIMEBASE=1/1000", f"START={round(segment.start * 1000)}",
                          f"END={round((segment.start + segment.duration) * 1000)}",
                          "title=" + self.metadata_escape(f"{segment.index:02} · {segment.title}")])
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def join_clips(self, clips: list[Path], metadata: Path) -> Path:
        concat_file = self.directory / "concat.txt"
        lines = ["file '" + str(path).replace("'", "'\\''") + "'" for path in clips]
        concat_file.write_text("\n".join(lines) + "\n")
        combined = self.directory / "rendered" / "combined.mp4"
        MediaTools.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                        "-i", str(concat_file), "-map", "0:v:0", "-map", "0:a:0", "-c", "copy",
                        "-movflags", "+faststart", str(combined)])
        target = self.directory / "RobinHacks-walkthrough.mp4"
        MediaTools.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(combined),
            "-i", str(self.directory / "captions.srt"), "-f", "ffmetadata", "-i", str(metadata),
            "-map", "0:v:0", "-map", "0:a:0", "-map", "1:0", "-map_metadata", "2", "-map_chapters", "2",
            "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
            "-metadata:s:s:0", "title=English captions", "-disposition:s:0", "0", "-movflags", "+faststart", str(target),
        ])
        return target

    def render(self, *, force: bool = False) -> Path:
        self.inspect_sources()
        self.prepare_frames()
        clips: list[Path] = []
        position = 0.0
        for segment in self.segments:
            segment.start = position
            clips.append(self.render_clip(segment, force=force))
            position += segment.duration
        CaptionBuilder(self.settings).write(self.segments, self.directory)
        metadata = self.write_metadata()
        target = self.join_clips(clips, metadata)
        chapters = [segment.chapter() for segment in self.segments]
        (self.directory / "chapters.json").write_text(json.dumps(chapters, indent=2, ensure_ascii=False))
        PlayerBuilder().write(self.segments, self.plan, self.directory)
        MediaTools.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "1.2", "-i", str(target),
                        "-frames:v", "1", "-update", "1", str(self.directory / "poster.png")])
        probe = MediaTools.probe(target)
        duration = MediaTools.duration(probe)
        (self.directory / "render-report.json").write_text(json.dumps({
            "title": self.plan.get("title"), "output": target.name, "durationSeconds": duration,
            "dimensions": [self.settings.width, self.settings.height], "framesPerSecond": self.settings.fps,
            "audioOffsetSeconds": self.settings.audio_offset,
            "captionMethod": "Sentence chunks with word-proportional timing over measured narration durations.",
            "sourcePolicy": "Actual browser pixels are kept at their native size. Short sources hold their final frame to finish the narration.",
            "segments": chapters, "streams": probe["streams"],
        }, indent=2, ensure_ascii=False))
        print(json.dumps({"video": str(target), "player": str(self.directory / "index.html"),
                          "durationSeconds": duration, "chapters": len(self.segments),
                          "sizeBytes": target.stat().st_size}, indent=2), flush=True)
        return target


PLAYER_TEMPLATE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>__TITLE__</title>
<style>
:root{font-family:"Avenir Next",Avenir,system-ui,sans-serif;color:#232a24;background:#f5f6f2;font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:55px 48px 65px}a{color:inherit}button,select{font:inherit}button,a,select{touch-action:manipulation}button:focus-visible,a:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #778cfb;outline-offset:4px}header{display:flex;gap:40px;justify-content:space-between;align-items:flex-end;margin-bottom:30px}.eyebrow{font-size:11px;font-weight:650;letter-spacing:1.7px;color:#66735f;margin-bottom:15px}h1{max-width:840px;font-size:39px;line-height:1.23;letter-spacing:-1.6px;margin:0;font-weight:600}header p{font-size:13px;line-height:1.7;color:#64715f;margin:16px 0 0}.duration{white-space:nowrap;border:1px solid #d5ddcf;border-radius:6px;padding:10px 14px;font-size:12px;color:#627157;background:#fff}.video-wrap{border:1px solid #d5ddd0;border-radius:13px;overflow:hidden;background:#e9ece7;box-shadow:0 16px 45px #2838220b}video{display:block;width:100%;aspect-ratio:16/9;background:#e9ece7}video::cue{font-family:"Avenir Next",Arial,sans-serif;font-size:22px;background:#172116e8;color:white}.player-bar{display:flex;gap:20px;justify-content:space-between;align-items:center;margin:17px 0 38px;flex-wrap:wrap}.current{font-size:12px;color:#64715f}.downloads{display:flex;gap:17px;align-items:center}.downloads a{font-size:12px;text-decoration:none;color:#475440;min-height:42px;display:inline-flex;align-items:center}.downloads .download-video{background:#2e49ef;color:#fff;border-radius:6px;padding:10px 16px}h2{font-size:22px;letter-spacing:-.6px;margin:0 0 17px;font-weight:600}.chapters{display:grid;grid-template-columns:1fr 1fr;gap:0 32px}.chapter{display:flex;align-items:center;gap:16px;min-height:76px;text-align:left;padding:15px 12px;border:0;border-bottom:1px solid #dee4d7;background:none;cursor:pointer;color:#263020;border-radius:5px 5px 0 0}.chapter:hover{background:#ecefe7}.chapter.active{background:#eceffe;border-color:#d5dcfa}.chapter-time{font-variant-numeric:tabular-nums;min-width:42px;font-size:12px;color:#64715f}.chapter>span:nth-child(2){flex:1}.chapter strong{font-size:13px;font-weight:600;line-height:1.5}.chapter small{display:block;font-size:10px;line-height:1.5;color:#718266;margin-top:5px}.chapter-number{color:#9bab90;font-size:11px}.chapter.active .chapter-time,.chapter.active .chapter-number{color:#2e49ef}details{margin-top:42px;border-top:1px solid #d9e1d1;padding-top:20px}summary{cursor:pointer;min-height:44px;font-size:14px;color:#44543a;padding:6px 0}details section{max-width:900px;padding:15px 0}details h3{font-size:15px;font-weight:600;margin:0 0 9px}details time{font-size:12px;color:#2e49ef;font-weight:400;margin-right:18px;font-variant-numeric:tabular-nums}details p{font-size:13px;line-height:1.9;margin:0;color:#627454}footer{border-top:1px solid #dae2d3;margin-top:42px;padding-top:21px;display:flex;gap:22px;justify-content:space-between;color:#6c7b61;font-size:11px;line-height:1.8}footer p{margin:0;max-width:900px}footer a{white-space:nowrap}.notice{font-size:11px;line-height:1.7;color:#78876b;margin-top:13px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:800px){main{padding:32px 20px 45px}header{gap:18px;align-items:flex-start;flex-wrap:wrap;margin-bottom:24px}h1{font-size:30px;letter-spacing:-1px}header p{font-size:12px}.duration{font-size:11px;padding:8px 11px}.player-bar{gap:12px;margin-bottom:30px}.downloads{gap:14px;flex-wrap:wrap}.downloads a{font-size:11px}.chapters{grid-template-columns:1fr}.chapter{padding:15px 8px;min-height:76px}.chapter strong{font-size:13px}footer{flex-direction:column;gap:14px}video::cue{font-size:16px}.video-wrap{border-radius:8px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body><main>
<header><div><div class="eyebrow">ROBINHACKS · PRODUCT WALKTHROUGH</div><h1>A team market, from first pitch to final results.</h1><p>Follow Alex’s team portfolio and Jamie’s organizer controls through a fictional sample event.</p></div><span class="duration">__DURATION__ · 1080p · Narrated</span></header>
<div class="video-wrap"><video id="walkthrough" controls playsinline preload="metadata" poster="poster.png"><source src="RobinHacks-walkthrough.mp4" type="video/mp4"><track id="english-captions" kind="captions" src="captions.vtt" srclang="en" label="English" default>Your browser cannot play this video. <a href="RobinHacks-walkthrough.mp4">Download the MP4.</a></video></div>
<div class="player-bar"><span id="current-chapter" class="current" aria-live="off">Choose a chapter below to jump to that part.</span><div class="downloads"><a class="download-video" href="RobinHacks-walkthrough.mp4" download>Download MP4 ↓</a><a href="captions.srt" download>SRT captions</a><a href="captions.vtt" download>VTT captions</a><a href="transcript.txt" download>Transcript</a></div></div>
<h2>In this walkthrough</h2><nav class="chapters" aria-label="Video chapters">__CHAPTERS__</nav>
<details><summary>Read the complete transcript</summary>__TRANSCRIPT__</details>
<footer><p>__DISCLOSURE__</p><a href="chapters.json" download>Chapter timings</a></footer>
<p class="notice">Captions follow the narration using approximate sentence timing. The app scenes are recordings of real local interactions.</p>
</main><script>
const video=document.getElementById('walkthrough');const chapters=[...document.querySelectorAll('.chapter')];const current=document.getElementById('current-chapter');
// A Blob URL lets captions work even when this standalone file is opened locally.
const captionData=__VTT__;const captionUrl=URL.createObjectURL(new Blob([captionData],{type:'text/vtt'}));document.getElementById('english-captions').src=captionUrl;
chapters.forEach(button=>button.addEventListener('click',()=>{video.currentTime=Number(button.dataset.start);video.play().catch(()=>{});video.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}));
function updateChapter(){let active=null;for(const button of chapters){const selected=video.currentTime>=Number(button.dataset.start)&&video.currentTime<Number(button.dataset.end);button.classList.toggle('active',selected);if(selected){button.setAttribute('aria-current','step');active=button;}else button.removeAttribute('aria-current');}if(active)current.textContent=`${active.querySelector('.chapter-number').textContent} · ${active.querySelector('strong').textContent}`;}
video.addEventListener('timeupdate',updateChapter);video.addEventListener('loadedmetadata',updateChapter);window.addEventListener('beforeunload',()=>URL.revokeObjectURL(captionUrl));
</script></body></html>'''


def self_test() -> None:
    """Test media composition without inspecting or modifying app recordings."""
    directory = Path(tempfile.mkdtemp(prefix="robinhacks-render-test-", dir="/private/tmp"))
    (directory / "audio").mkdir()
    (directory / "raw").mkdir()
    items = []
    for index, (identifier, size, color) in enumerate([
        ("01-test-desktop", "1600x900", "#f8f9f6"),
        ("12-test-mobile", "390x844", "#d9e3ff"),
    ], 1):
        MediaTools.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        f"color=c={color}:s={size}:r=30:d=1.6", "-c:v", "libvpx", "-deadline", "realtime",
                        str(directory / "raw" / f"{identifier}.webm")])
        MediaTools.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=48000:duration=0.6", "-c:a", "pcm_s16le",
                        str(directory / "audio" / f"{identifier}.wav")])
        items.append({"id": identifier, "title": "Render pipeline check" if index == 1 else "Mobile frame check",
                      "perspective": "Local test fixture", "narration": "This is a temporary render check.",
                      "durationSeconds": 0.6, "audioPath": f"audio/{identifier}.wav"})
    plan = directory / "narration-plan.json"
    plan.write_text(json.dumps({"title": "Temporary render check", "disclosure": "Synthetic test fixture. Not app footage.", "segments": items}))
    target = WalkthroughRenderer(plan).render()
    result = MediaTools.probe(target)
    streams = result["streams"]
    assert any(s.get("codec_name") == "h264" and s.get("width") == 1920 and s.get("height") == 1080 for s in streams)
    assert any(s.get("codec_name") == "aac" and s.get("sample_rate") == "48000" for s in streams)
    assert any(s.get("codec_name") == "mov_text" for s in streams)
    assert MediaTools.duration(result) >= 3.2
    print(f"Self-test passed. Synthetic test artifacts only: {directory}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=Path("output/playwright/walkthrough/narration-plan.json"))
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--frames-only", action="store_true", help="Prepare transparent presentation frames without reading raw captures.")
    parser.add_argument("--force", action="store_true", help="Re-encode clips even when their source fingerprint is unchanged.")
    parser.add_argument("--self-test", action="store_true", help="Verify composition with temporary synthetic sources, never app footage.")
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
        else:
            renderer = WalkthroughRenderer(args.plan, args.output)
            if args.frames_only:
                renderer.prepare_frames()
            else:
                renderer.render(force=args.force)
    except (RuntimeError, ValueError, OSError, KeyError) as error:
        print(f"Render failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
