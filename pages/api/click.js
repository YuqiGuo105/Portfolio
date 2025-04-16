// src/click.js
import { supabase } from '../../src/supabase/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // Destructure the expected data
    const { clickEvent, targetUrl, localTime } = req.body;

    // Extract the visitor's IP address from headers (or fallback)
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0] : req.socket.remoteAddress;

    // Insert the click event into the visitor_clicks table
    const { data, error } = await supabase
      .from("visitor_clicks")
      .insert([{ click_event: clickEvent, target_url: targetUrl, local_time: localTime, ip }]);

    if (error) throw error;

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error logging click event:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
