import { stats } from './_store.js';
import { json } from './_util.js';

export async function onRequestGet() {
  return json(200, Object.assign({ ok: true, stub: true }, stats()));
}
