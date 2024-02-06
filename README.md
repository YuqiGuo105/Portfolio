# Yuqi Guo's Portfolio Blog

This Next.js application showcases a dynamic portfolio with a contact form that emails submissions directly to your inbox, utilizing serverless functions for backend operations. It features project detail pages with parallax images and navigational links to browse through projects sequentially.

Demo Link: https://www.yuqi.site

## Features

- Dynamic project pages with detailed information.
- Contact form integrated with serverless API to send messages via email.
- Navigation to the next project for seamless browsing experience.
- Parallax effect for project images.

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

### Install NPM packages
- Clone the repo
  ```sh
  npm install
  ```

### Set up environment variables in '.env'
  ```
  NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
  SENDGRID_API_KEY=YOUR_SENDGRID_API_KEY
  ```

### Running the project
- Clone the repo
  ```sh
  npm run dev
  ```

## Usage
- Browse the project portfolio and use the contact form to send messages directly to the project owner's email.
- Utilize Supabase as database, so user can edit work/blog part.

## Contributing
Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

## License
Distributed under the MIT License. See LICENSE for more information.