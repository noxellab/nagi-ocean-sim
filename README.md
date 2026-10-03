# NAGI

[日本語](#日本語) | [English](#english)

## 日本語

Three.js / WebGL 2 の海シェーダー。3帯域のスペクトル波、泡、海底の屈折、HDR環境光を描画します。

### 起動

Node.js 24.15以降の24.xを使用してください。

```sh
npm ci
npm run dev
```

表示されたローカルURLをWebGL 2対応ブラウザで開きます。

```sh
npm test
npm run build
npm run preview
```

ビルド結果は `dist/`。静的HTTPサーバーで配信できます。実行時の外部通信はありません。

### 操作

- ドラッグ：視点、スクロール／ピンチ：高さ
- Space：再生／停止、H：操作パネル表示
- 情景・波高・風・太陽・画質は操作パネルで変更
- 波高は0.25〜1.5。動きを減らす設定では停止状態で起動

### 構成

- `src/ocean.js`：描画、泡、操作
- `src/spectral-ocean.js`：256² × 3帯域のFFT波
- `src/refraction.js`、`src/seabed.js`：屈折と海底
- `src/photo-sky.js`、`src/atmosphere.js`：空と環境光
- `public/`：実行用画像と放射輝度データ

スペクトル波は浮動小数点レンダーターゲットが必要です。利用できない場合は軽量な波の描画に切り替わります。

`createSpectralOcean(THREE, renderer)` は `cascades`、`update(time, rate, amplitude)`、`validate()`、`dispose()` を返します。浮動小数点描画が未対応なら `null` を返します。`cascades[i].output.textures` は変位と法線・圧縮度の2枚です。時刻は秒、更新頻度は10〜60Hzです。

`npm test` は数値処理、操作、リソース解放、読み込み失敗を検証します。GPU描画の検証は含みません。

画像生成ツールの依存をインストールし、泡画像を再生成できます：

```sh
python -m pip install -r tools/requirements.txt
python tools/generate-foam.py
```

空画像の再生成には、`THIRD_PARTY_NOTICES.txt` に記載した空の4096×2048 EXRを指定します。

```sh
python tools/generate-sky.py path/to/sky.exr --output public
```

### ライセンス

コードと泡画像はMIT。空画像・放射輝度データはCC0-1.0。依存コードの通知は `THIRD_PARTY_NOTICES.txt` に記載しています。

## English

An ocean shader for Three.js / WebGL 2. It renders three-band spectral waves, foam, seabed refraction and HDR environment lighting.

### Getting started

Use Node.js 24.x, version 24.15 or later.

```sh
npm ci
npm run dev
```

Open the printed local URL in a browser that supports WebGL 2.

```sh
npm test
npm run build
npm run preview
```

The build output goes to `dist/` and can be served by any static HTTP server. The app makes no external network requests at runtime.

### Controls

- Drag: look around; scroll / pinch: camera height
- Space: play / pause; H: show / hide the control panel
- Scene, wave height, wind, sun and quality are set in the control panel
- Wave height ranges from 0.25 to 1.5. With reduced motion enabled, the app starts paused

### Structure

- `src/ocean.js`: rendering, foam, controls
- `src/spectral-ocean.js`: FFT waves, 256² × 3 bands
- `src/refraction.js`, `src/seabed.js`: refraction and seabed
- `src/photo-sky.js`, `src/atmosphere.js`: sky and environment lighting
- `public/`: runtime images and radiance data

Spectral waves require floating-point render targets. Without them, the app falls back to lighter wave rendering.

`createSpectralOcean(THREE, renderer)` returns `cascades`, `update(time, rate, amplitude)`, `validate()` and `dispose()`, or `null` when floating-point rendering is unsupported. `cascades[i].output.textures` holds two textures: displacement, and normal with compression. Time is in seconds; the update rate is 10–60 Hz.

`npm test` covers numerics, controls, resource disposal and loading failures. It does not verify GPU rendering.

To regenerate the foam image, install the tool dependencies and run:

```sh
python -m pip install -r tools/requirements.txt
python tools/generate-foam.py
```

To regenerate the sky images, pass the 4096×2048 sky EXR listed in `THIRD_PARTY_NOTICES.txt`.

```sh
python tools/generate-sky.py path/to/sky.exr --output public
```

### License

Code and the foam image are MIT. Sky images and radiance data are CC0-1.0. Notices for dependency code are in `THIRD_PARTY_NOTICES.txt`.
