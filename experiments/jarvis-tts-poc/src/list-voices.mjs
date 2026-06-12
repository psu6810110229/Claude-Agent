// List candidate JARVIS voices: all Thai voices + all multilingual voices.
// Multilingual voices speak BOTH Thai and English in one consistent character.
import { MsEdgeTTS } from "msedge-tts";

const tts = new MsEdgeTTS();
const voices = await tts.getVoices();

const thai = voices.filter((v) => v.Locale.startsWith("th-"));
const multi = voices.filter((v) => /Multilingual/i.test(v.ShortName));

const fmt = (v) => `  ${v.ShortName.padEnd(34)} ${v.Gender.padEnd(7)} ${v.Locale.padEnd(8)} ${v.FriendlyName}`;

console.log(`\n=== Thai voices (${thai.length}) ===`);
thai.forEach((v) => console.log(fmt(v)));

console.log(`\n=== Multilingual voices (${multi.length}) — male only shown ===`);
multi.filter((v) => v.Gender === "Male").forEach((v) => console.log(fmt(v)));
