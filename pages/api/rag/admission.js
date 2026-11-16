import { chatAdmissionRuntime } from '../../../src/lib/chat/admissionRuntime.mjs';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

// The chat's waiting line: POST { action: "enter" | "leave" } with the widget's device header.
export default function handler(req, res) { return chatAdmissionRuntime().handler(req, res); }
