// Import the wolf as a Vite asset so it resolves in BOTH dev (http) and the
// packaged build (file://) — an absolute "/wolf-icon.png" breaks under file://.
import wolfUrl from '../assets/wolf-icon.png'
export default wolfUrl
