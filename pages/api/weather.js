const WEATHER_CODE_MAP = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  80: "Rain showers",
  81: "Heavy rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

export default async function handler(req, res) {
  try {
    const forwarded = req.headers["x-forwarded-for"]; // may contain multiple IPs
    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(",")[0]?.trim() || req.socket?.remoteAddress;

    let location;
    if (ip && ip !== "::1" && ip !== "127.0.0.1" && ip !== "::ffff:127.0.0.1") {
      const locationResp = await fetch(`https://ipapi.co/${ip}/json/`);
      if (locationResp.ok) {
        const locJson = await locationResp.json();
        if (locJson && locJson.latitude && locJson.longitude) {
          location = {
            city: locJson.city,
            region: locJson.region,
            country: locJson.country_name,
            latitude: locJson.latitude,
            longitude: locJson.longitude,
          };
        }
      }
    }

    if (!location) {
      // fallback to New York City
      location = {
        city: "New York",
        region: "NY",
        country: "United States",
        latitude: 40.7128,
        longitude: -74.006,
        fallback: true,
      };
    }

    const weatherResp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code&daily=sunrise,sunset&temperature_unit=fahrenheit&timezone=auto`
    );

    if (!weatherResp.ok) {
      throw new Error(`Open-Meteo request failed with ${weatherResp.status}`);
    }

    const weatherJson = await weatherResp.json();
    const current = weatherJson.current ?? {};
    const daily = weatherJson.daily ?? {};

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate");
    res.status(200).json({
      location,
      temperature: current.temperature_2m ?? null,
      weatherCode: current.weather_code ?? null,
      weatherDescription:
        WEATHER_CODE_MAP[current.weather_code] ?? "Partly cloudy",
      sunrise: daily.sunrise?.[0] ?? null,
      sunset: daily.sunset?.[0] ?? null,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    console.error("Weather API error", error);
    res.status(200).json({
      location: {
        city: "New York",
        region: "NY",
        country: "United States",
      },
      temperature: 49,
      weatherCode: 2,
      weatherDescription: "Partly cloudy",
      sunrise: new Date().setHours(7, 53, 0, 0),
      sunset: new Date().setHours(18, 29, 0, 0),
      fetchedAt: Date.now() - 2 * 60 * 60 * 1000,
      fallback: true,
    });
  }
}
