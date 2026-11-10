import { collecting, studyMode } from "../lib/store.js";
import { send } from "../lib/http.js";

export default function handler(req, res) {
  send(res, 200, { collecting: collecting(), mode: studyMode(), irb_protocol: process.env.IRB_PROTOCOL || null, audio: collecting() && process.env.COLLECT_AUDIO === "true" });
}
