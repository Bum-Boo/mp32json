# mp32json

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

`ffmpeg`으로 오디오 파일을 웹 비주얼라이저와 오디오 반응형 UI용 compact JSON 프로필로 변환하는, JavaScript 의존성 없는 Node.js CLI입니다.

## 기능과 한계

단일 파일 또는 폴더를 재귀적으로 일괄 분석하며 AAC, AIFF, FLAC, M4A, MP3, OGG, Opus, WAV, WebM을 지원합니다(`ffmpeg` 디코딩 가능 여부에 따름). `rms`, `low`, `mid`, `high`, `flux`, `beat`, `bloom`을 0~255 값으로 저장하며 compact 또는 readable JSON을 출력합니다.

간단한 one-pole filter와 곡별 정규화, 휴리스틱 비트 감지를 사용하므로 음악 정보 검색·마스터링 도구가 아니며 비트 결과는 근사치입니다.

## 요구 사항과 실행

Node.js 20 이상과 PATH에서 실행 가능한 `ffmpeg`가 필요합니다. 패키지는 `private`이며 npm 배포본이나 실행 파일 릴리스가 없습니다. JavaScript 의존성이 없어 `npm install`은 필요하지 않습니다.

```bash
node src/analyze-audio.js --help
node src/analyze-audio.js "song.mp3" --album-id my-song --output result/my-song.profile.json
npm run batch
```

일괄 모드는 기본적으로 `source/`를 재귀 탐색해 `result/`에 씁니다. 옵션은 `--fps`(기본 30), `--format compact|readable`, `--output`, `--source-dir`, `--result-dir`입니다. 단일 파일에서 `--output`을 생략하면 stdout에 출력합니다. 바이너리 `.u8`은 미구현입니다. 파일명으로 만든 slug가 같으면 일괄 결과가 덮어써질 수 있으므로 고유한 기본 파일명을 사용하세요.

## 출력 사용

`frames`의 각 값은 0~255 정수입니다. 재생 시점의 index를 `Math.floor(currentTime * profile.fps)`로 구하고 채널 값을 255로 나누어 0~1로 사용합니다. 출력에는 `version`, `albumId`, `fps`, `duration`, `channels`, `frames`, `beats`가 포함됩니다.

## 개인정보·저작권·리소스 제한

분석은 로컬에서 실행되고 오디오를 업로드하지 않습니다. 실제 `source/`·`result/` 파일은 gitignore 대상이지만 로컬 관리 책임은 사용자에게 있습니다. 소유하거나 처리 허가를 받은 오디오만 분석하고 원본을 무단 커밋·배포하지 마세요. 생성 데이터가 원본의 저작권·라이선스 제한을 없애지 않습니다. 디코딩된 오디오와 프레임을 메모리에 보관하며 ffmpeg 출력 buffer는 512 MiB이므로 긴 파일은 메모리를 많이 쓸 수 있습니다.

## 상태와 검증

초기 `0.1.0` 도구이며 자동 테스트 모음은 없습니다. `--help`로 CLI를 확인한 뒤, 사용 권한이 있는 작은 오디오로 실제 분석을 검증하세요.

![JSON 결과 예시](demo-screenshots/song-analyzer-flow-01-json-result.png)

## 라이선스와 출처 표기 요청

별도 라이선스 파일이 없습니다. 공개 소스만으로 복제·수정·재배포 권한을 가정하지 말고 필요한 권리를 확인하세요. 프로젝트를 소개하거나 허가받은 파생 작업에 사용한다면 `@Bum-Boo`와 [원본 저장소](https://github.com/Bum-Boo/mp32json)를 언급해 주시면 감사하겠습니다. 이는 정중한 요청이며 라이선스 의무를 추가하거나 대체하지 않습니다.
