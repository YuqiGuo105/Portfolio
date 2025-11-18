import Layout from "../../src/layout/Layout";
import {supabase} from '../../src/supabase/supabaseClient';
import {useRouter} from 'next/router';
import {useState, useEffect} from 'react';
import DOMPurify from 'dompurify';

const LifeBlog = () => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const {id} = router.query;
  const [loggedIn,  setLoggedIn]  = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // Log click events for analytics
  const recordClick = async (clickEvent, targetUrl) => {
    const localTime = new Date().toISOString();
    const pageUrl   = targetUrl || (typeof window !== 'undefined' ? window.location.href : null);
    try {
      await fetch('/api/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clickEvent, targetUrl: pageUrl, localTime })
      });
    } catch (err) {
      console.error("Error logging click event:", err);
    }
  };

  /* ────────── 1. one‑off session check ────────── */
  useEffect(() => {
    (async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error) console.error("Session err:", error);
      setLoggedIn(!!session);
    })();
  }, []);

  /* ────────── 2. fetch post when id ready ────────── */
  useEffect(() => {
    if (!id || loggedIn === null) return;   // wait for dynamic route & auth

    const fetchBlog = async () => {
      const { data, error } = await supabase
        .from("life_blogs")                // ← correct table
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        setError(error);
        setLoading(false);
        return;
      }

      /* gate: requires login? */
      if (data.require_login && !loggedIn) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      /* sanitise & store */
      data.content = DOMPurify.sanitize(data.content ?? "");
      setAccessDenied(false);
      setBlog(data);
      setLoading(false);
    };

    fetchBlog();
  }, [id, loggedIn, router]);

  /* ────────── 3. record access after auth gate ────────── */
  useEffect(() => {
    if (loading || accessDenied) return;
    if (blog) {
      recordClick('page-load');
    }
  }, [accessDenied, blog, loading]);

  /* ────────── guard rails ────────── */
  if (accessDenied) {
    return (
      <Layout extraWrapClass={"single-post"}>
        <section className="section section-inner started-heading">
          <div className="container">
            <div className="row">
              <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                <div className="m-titles">
                  <h1 className="m-title">Login Required</h1>
                  <div className="m-category">
                    Please log in to view this life blog post.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    );
  }
  if (loading) return <div>Loading…</div>;
  if (error)   return <div>Error loading blog post.</div>;
  if (!blog)   return <div>Blog post not found.</div>;

  /* ────────── render ────────── */
  return (
    <Layout extraWrapClass={"single-post"}>
      {/* Section Started Heading */}
      <section className="section section-inner started-heading">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
              {/* titles */}
              <div className="m-titles">
                <h1 className="m-title">{blog.title}</h1>
                <div className="m-category">
                  <a
                    href="#"
                    rel="category tag"
                    
                  >
                    {blog.category}
                  </a>{" "}
                  / {blog.date}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Single Post */}
      <section className="section section-inner m-archive">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-12 col-lg-10 offset-1">

              {/* content */}
              <div className="description">
                <div
                  className="post-content"
                >

                  <div className="post-content" dangerouslySetInnerHTML={{__html: blog.content}}></div>

                  {/* Tags Section */}
                  <span className="tags-links">
                     <span>Tags:</span>
                    {blog.tags.split(',').map((tag, index) => (
                      // Assuming you want to simply display the tags without linking to a specific URL
                      // If you have a tagging system where each tag has a specific URL, adjust the href accordingly
                      <a
                        href="#"
                        key={index}
                      >
                        {tag.trim()} {/* Trim to remove any potential whitespace */}
                        {index < blog.tags.split(',').length - 1 ? '' : ''}
                      </a>
                    ))}
                    </span>

                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </Layout>
  );
};
export default LifeBlog;
