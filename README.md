# mp32json

음악 파일을 분석해서 React 비주얼에 연결하기 쉬운 compact JSON으로 변환하는 CLI 도구입니다.

오디오는 한 번만 분석하고, React에서는 재생 시간으로 JSON frame만 읽으면 됩니다.

## 준비

필요한 것:

- Node.js 20+
- `ffmpeg`

## 폴더 구조

```text
source/  분석할 음악 파일 넣는 곳
result/  생성된 JSON 저장되는 곳
```

`source`와 `result` 안의 실제 파일은 git에 올라가지 않도록 제외되어 있습니다.

## 실행

`source` 폴더에 음악 파일을 넣습니다.

```text
source/Brutal.mp3
source/The Plush.mp3
```

그 다음 실행:

```powershell
npm run batch
```

결과는 `result` 폴더에 저장됩니다.

```text
result/brutal.profile.json
result/the-plush.profile.json
```

## 단일 파일만 분석

```powershell
node src/analyze-audio.js "song.mp3" --album-id brutal --output result/brutal.profile.json
```

## 출력 형식

```json
{
  "version": 1,
  "albumId": "brutal",
  "fps": 30,
  "duration": 180,
  "channels": ["rms", "low", "mid", "high", "flux", "beat", "bloom"],
  "frames": [
    [12, 31, 18, 8, 4, 0, 20]
  ],
  "beats": [0.48, 0.96, 1.44]
}
```

`frames` 값은 `0~255` 정수입니다. React에서 사용할 때는 `255`로 나눠서 `0~1` 값으로 바꿉니다.

## React에서 사용

```ts
const frameIndex = Math.floor(currentTime * profile.fps);
const frame = profile.frames[frameIndex] ?? [];

const values = Object.fromEntries(
  profile.channels.map((channel, index) => [channel, (frame[index] ?? 0) / 255])
);
```

CSS 변수로 연결:

```ts
element.style.setProperty("--audio-rms", String(values.rms ?? 0));
element.style.setProperty("--audio-low", String(values.low ?? 0));
element.style.setProperty("--audio-mid", String(values.mid ?? 0));
element.style.setProperty("--audio-high", String(values.high ?? 0));
element.style.setProperty("--audio-flux", String(values.flux ?? 0));
element.style.setProperty("--audio-beat", String(values.beat ?? 0));
element.style.setProperty("--audio-bloom", String(values.bloom ?? 0));
```

## 채널

- `rms`: 전체 음량
- `low`: 저역
- `mid`: 중역
- `high`: 고역
- `flux`: 프레임 간 변화량
- `beat`: 비트 감지
- `bloom`: 비주얼용 통합 에너지

## 참고

- 기본 분석 fps는 `30`입니다.
- 기본 출력은 compact JSON입니다.
- 디버깅용 readable JSON:

```powershell
node src/analyze-audio.js "song.mp3" --format readable --output result/song.readable.json
```

- 바이너리 `.u8` 출력은 아직 구현하지 않았습니다.
