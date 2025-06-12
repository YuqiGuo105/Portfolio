import Layout from "../../src/layout/Layout";
import {supabase} from '../../src/supabase/supabaseClient';
import {useRouter} from 'next/router';
import {useState, useEffect} from 'react';
import DOMPurify from 'dompurify';

const BlogSingle = () => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const {id} = router.query;

  // Log click events for analytics
  const recordClick = async (clickEvent, targetUrl) => {
    const localTime = new Date().toISOString();
    const pageUrl   = targetUrl || window.location.href;
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

  useEffect(() => {
    recordClick('page-load');
  }, []);

  useEffect(() => {
    if (!id) return; // Avoid fetching if the id isn't available yet

    const fetchBlog = async () => {
      const {data, error} = await supabase
        .from('Blogs') // Adjust this to your actual table name
        .select('*')
        .eq('id', id)
        .single(); // Assumes 'id' is unique and returns a single item

      if (error) {
        setError(error);
        setLoading(false);
      } else {
        // Sanitize the HTML content
        data.content = DOMPurify.sanitize(data.content);

        setBlog(data);
        setLoading(false);
      }
    };

    fetchBlog();
  }, [id]); // This effect depends on 'id' and runs again if 'id' changes

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error loading blog post.</div>;
  if (!blog) return <div>Blog post not found.</div>;

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
export default BlogSingle;
