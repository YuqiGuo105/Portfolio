import Layout from "../../src/layout/Layout";
import {supabase} from '../../src/supabase/supabaseClient';

import {useRouter} from 'next/router';
import {useState, useEffect} from 'react';
import BlogComments from "../../src/components/BlogComments";
import DOMPurify from 'dompurify';

// Listing fields; anonymous visitors cannot read the content column (see the RPC below).
const LISTING_FIELDS = "id, title, image_url, category, published_at, description, require_login, created_at, updated_at, tags";

const LifeBlog = () => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const {id} = router.query;
  const [loggedIn,  setLoggedIn]  = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // Track page view via the dedicated tracking endpoint (only after auth gate resolves).

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
        .from("life_blogs")
        .select(LISTING_FIELDS)
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

      /* The body comes from life_blog_content(), which only returns login-only posts to signed-in
         users (supabase/migrations/20261101120000_public_read_policies.sql). Until that migration
         is applied the function does not exist, so fall back to reading the column directly. */
      let body = await supabase.rpc("life_blog_content", { post_id: Number(id) });
      if (body.error && ["PGRST202", "42883"].includes(body.error.code)) {
        body = await supabase.from("life_blogs").select("content").eq("id", id).single();
        body = { data: body.data?.content ?? null, error: body.error };
      }
      if (body.error) {
        setError(body.error);
        setLoading(false);
        return;
      }
      if (body.data == null && data.require_login) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      /* sanitise & store */
      data.content = DOMPurify.sanitize(body.data ?? "");
      setAccessDenied(false);
      setBlog(data);
      setLoading(false);
    };

    fetchBlog();
  }, [id, loggedIn, router]);

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
                    {blog.tags && blog.tags.split(',').map((tag, index) => (
                      <a
                        href={`/blogs?tag=${encodeURIComponent(tag.trim())}`}
                        key={index}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/blogs?tag=${encodeURIComponent(tag.trim())}`);
                        }}
                      >
                        {tag.trim()}
                      </a>
                    ))}
                    </span>

                </div>
              </div>

              {/* Comments Section */}
              <BlogComments blogId={blog.id} blogType="life" />
            </div>

          </div>
        </div>
      </section>
    </Layout>
  );
};
export default LifeBlog;
