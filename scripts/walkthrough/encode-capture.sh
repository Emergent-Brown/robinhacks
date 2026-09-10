#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf '%s\n' 'Usage: bash scripts/walkthrough/encode-capture.sh INPUT.webm OUTPUT.mp4 [NARRATION.wav]' >&2
  exit 1
fi
input_path="$1"
output_path="$2"
[[ -f "$input_path" ]] || { printf 'Missing video: %s\n' "$input_path" >&2; exit 1; }
mkdir -p "$(dirname "$output_path")"

# Preserve the entire browser frame and letterbox when the capture aspect ratio
# differs from 16:9. yuv420p and faststart make the MP4 easy to preview and share.
video_filter='scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf8f9f6,setsar=1'
if [[ $# -eq 3 ]]; then
  narration_path="$3"
  [[ -f "$narration_path" ]] || { printf 'Missing narration: %s\n' "$narration_path" >&2; exit 1; }
  ffmpeg -hide_banner -n -i "$input_path" -i "$narration_path" \
    -map 0:v:0 -map 1:a:0 -vf "$video_filter" -af apad \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 \
    -c:a aac -b:a 192k -shortest -movflags +faststart "$output_path"
else
  ffmpeg -hide_banner -n -i "$input_path" -map 0:v:0 -an \
    -vf "$video_filter" -c:v libx264 -preset medium -crf 18 \
    -pix_fmt yuv420p -r 30 -movflags +faststart "$output_path"
fi
ffprobe -v error -show_entries 'format=duration,size:stream=codec_name,width,height,r_frame_rate' -of json "$output_path"
