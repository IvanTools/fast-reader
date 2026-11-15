# Natural voice files

Fast Reader's "Natural" voices run entirely in your browser.

- `model.onnx`: the tiny-voca text-to-speech model by Muhammed Nazeem (https://huggingface.co/n4ze3m/tiny-voca), Apache-2.0. Unmodified.
- `dizione-core.js`, `dizione-text.js`: a JavaScript port of the dizione phonemizer by Muhammed Nazeem (https://github.com/n4ze3m/dizione), Apache-2.0. Ported for Fast Reader; output matches the Python original.
- `lexicon.tsv`, `g2p.bin`, `dizione-data.json`: dizione's pronunciation data (converted to browser-friendly formats). Derived from the CMU Pronouncing Dictionary and the Wikipedia Homograph Data; see `LICENSE.cmudict` and `LICENSE.homograph-data`.
- `ort.wasm.min.js`, `ort-wasm-simd-threaded.*`: ONNX Runtime Web 1.31.1 by Microsoft, MIT License.
- `tts-worker.js`: Fast Reader's glue code.

Copies are kept here so the app does not depend on the original repositories staying online.
