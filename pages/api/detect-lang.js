export default function handler(req, res) {
  const country = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || '';
  const acceptLang = req.headers['accept-language'] || '';
  res.status(200).json({ country, acceptLang });
}
