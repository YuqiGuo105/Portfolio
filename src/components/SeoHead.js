import Head from 'next/head'

const SeoHead = ({
  title,
  description = "Portfolio and blog of Yuqi Guo featuring project showcases and tech articles.",
  keywords = "Yuqi Guo, portfolio, blog, projects, software engineer",
  image = "/assets/images/profile_guyuqi.jpg",
  url = "https://www.yuqi.site"
}) => {
  const siteTitle = "Yuqi Guo's Blog";
  const metaTitle = title ? `${title} | ${siteTitle}` : siteTitle;
  const metaUrl = url;

  return (
    <Head>
      <title>{metaTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <link rel="canonical" href={metaUrl} />
      {/* Open Graph / Facebook */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={metaUrl} />
      <meta property="og:title" content={metaTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={metaUrl} />
      <meta name="twitter:title" content={metaTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Head>
  )
}

export default SeoHead
