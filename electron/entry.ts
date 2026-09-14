// Select the isolated test browser before importing desktop initialization.
// A worker must never install CLIs, load account state, or open the IDE.
if (process.argv.includes('--nalu-browser-worker')) {
  void import('./browserWorker')
} else {
  void import('./main')
}
