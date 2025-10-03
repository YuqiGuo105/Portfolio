# Yuqi Guo's Portfolio Blog

This Next.js application showcases a dynamic portfolio with a contact form that emails submissions directly to your inbox, utilizing serverless functions for backend operations. It features project detail pages with parallax images and navigational links to browse through projects sequentially.

🌐: https://www.yuqi.site

## Features

- Dynamic project pages with detailed information.
- Contact form integrated with serverless API to send messages via email.
- Navigation to the next project for seamless browsing experience.
- Utilize Supabase as the database backend, enabling users to seamlessly manage their "Works" or "Blogs" directly through the Supabase console.
- Parallax effect for project images.
- Datalake to record visitor's operations for analysis.

## Getting Started

To get a local copy up and running follow these simple steps.

### Prerequisites

- npm
  ```sh
  npm install npm@latest -g
  ```

### Installation
- Clone the repo
  ```sh
  git clone https://github.com/YuqiGuo105/Portfolio.git
  ```

- Install NPM packages
  ```sh
  npm install
  ```

- Set up environment variables in '.env'
  ```
  NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
  EMAIL_USER=USER_EMAIL
  EMAIL_PASS=YOUR_PASS
  EMAIL_TO=TO_USER
  ```

### Supabase setup

1. **Create a project** at [app.supabase.com](https://app.supabase.com) and copy the "Project URL" and "anon" API key from the _Project Settings → API_ page. Paste them into the `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` variables shown above.
2. **Create the `visitor_logs` table** (used by `/api/track`) by running the SQL below in the Supabase SQL editor:
   ```sql
   create table if not exists public.visitor_logs (
     id uuid default gen_random_uuid() primary key,
     created_at timestamptz default now(),
     local_time timestamptz,
     event text,
     ip text,
     ua text,
     country text,
     region text,
     city text,
     latitude double precision,
     longitude double precision
   );
   ```
3. **Enable Row Level Security (RLS)** on the table and add a policy to allow inserts from the anon key:
   ```sql
   alter table public.visitor_logs enable row level security;

   create policy "Allow inserts from anon" on public.visitor_logs
     for insert
     to anon
     with check (true);
   ```
4. Deploy the updated environment variables to Vercel (or your hosting provider) so the API route can access Supabase in production.

- Running the project
  ```sh
  npm run dev
  ```

## Usage
- Browse the project portfolio and use the contact form to send messages directly to the project owner's email.
- Utilize Supabase as database, so user can edit work/blog part.
- Integrate WYSIWYG to web content that user can easily editor "Blogs"/"Work" content.

## SEO Improvements
This project includes basic search engine optimization features:
- Meta tags for titles and descriptions using a reusable `SeoHead` component.
- `robots.txt` and `sitemap.xml` are provided in the `public` folder for better crawling.
## Contributing
Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

## License
Distributed under the MIT License. See LICENSE for more information.
