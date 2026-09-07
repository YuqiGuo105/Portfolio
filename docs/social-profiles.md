# Social Profile Links

The homepage, footer, and navigation use the same social link configuration.
Set these public environment variables locally and in the hosting environment:

```dotenv
NEXT_PUBLIC_GITHUB_URL=https://github.com/YuqiGuo105
NEXT_PUBLIC_LEETCODE_URL=https://leetcode.com/u/SY0JvhmwHK/
NEXT_PUBLIC_INSTAGRAM_URL=https://www.instagram.com/yuqi_guo17/
```

Only HTTPS URLs without embedded credentials are accepted. Empty or invalid
values hide the corresponding link. These are public profile addresses, not
secrets. Do not commit actual environment files.

Next.js bundles `NEXT_PUBLIC_` values at build time. Restart the development
server locally, or rebuild and redeploy after changing production values.

LeetCode uses a local vector icon; all three links have matching 44px targets,
accessible names, keyboard focus indicators, and hover/focus tooltips.
