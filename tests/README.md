# Testing Visualizer

To test the visualizer with thousands of different SPIR-V module to ensure it won't crash loading a module, a QUnitJS test setup is created.

The reason for QUnitJS was it was the simplest and runs from the client side. Running from server side using NodeJS becomes slightly more complex due to having to fake the DOM properly.

## Testing a single file quickly

To quickly test a single file, toggle the debug mode to true in `index.html`

```js
const DEBUG=true; // toggle
const DEBUG_FILE="tests/samples/type.spv";
```

This will save time having to manually load it up each time

## Running test suite

1. Add as many SPIR-V binaries to `./tests` directory (will have to `mkdir` it first)
2. run `node getFiles.js` and it will produce a `tests.json` file by scanning the `./tests/` for `.spv` files
3. In `index.html` uncomment the testing coding which will set `TEST_SUITE` to `true`
4. Load the page, from here `tests/tests.js` will parse the `tests.json` file and run each shader through as if you selected the file manually

Due to the async nature of loading `ArrayBuffers` from the client side and running a QUnitJS test, the only way around is to load up the binary into the browsers memory as a `Blob` object and then use. The `tests.js` is a few function calls to allow loading in a handful of files at a time and then clearing them out to reduce the memory pressure. while this method is a little slower, it has been proven to work with over tens thousands shaders without crashing the browser.