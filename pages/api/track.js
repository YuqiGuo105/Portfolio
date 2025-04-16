// src/track.js
import { supabase } from '../../src/supabase/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Get the visitor's local time from the request body;
    // default to the current server time if not provided.
    const localTime = req.body.localTime || new Date().toISOString();

    // Get the visitor's IP address. If behind a proxy, use the x-forwarded-for header.
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;

    // Insert the tracking data into the Supabase table 'visitor_logs'
    const { data, error } = await supabase
      .from('visitor_logs')
      .insert([{ ip, local_time: localTime }]);

    if (error) throw error;

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error tracking visitor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
