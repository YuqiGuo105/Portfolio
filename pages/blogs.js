import Link from "next/link";
import Layout from "../src/layout/Layout";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../src/supabase/supabaseClient';
import SeoHead from "../src/components/SeoHead";
import LogInDialog from "../src/components/LogInDialog";

// Pagination Component
const Pagination = ({ totalItems, itemsPerPage, currentPage, onPageChange }) => {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  if (totalPages <= 1) return null;

  return (
    <div className="pager">
      {currentPage > 1 && (
        <a className="prev page-numbers" href="#" onClick={(e) => { e.preventDefault(); onPageChange(currentPage - 1); }}>
          <i className="icon-arrow" /> Prev
        </a>
      )}
      {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
        <a
          key={page}
          href="#"
          className={`page-numbers ${page === currentPage ? 'current' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            onPageChange(page);
          }}
        >
          {page}
        </a>
      ))}
      {currentPage < totalPages && (
        <a className="next page-numbers" href="#" onClick={(e) => { e.preventDefault(); onPageChange(currentPage + 1); }}>
          Next <i className="icon-arrow" />
        </a>
      )}
    </div>
  );
};

const Blogs = () => {
  const router = useRouter();
  const { tag: queryTag, type: queryType } = router.query;

  const [allBlogs, setAllBlogs] = useState([]);
  const [filteredBlogs, setFilteredBlogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(6);
  
  // Filter states
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedType, setSelectedType] = useState('all'); // 'all', 'technical', 'life'
  const [allTags, setAllTags] = useState([]);
  
  // Login states
  const [showLogin, setShowLogin] = useState(false);
  const [pendingNext, setPendingNext] = useState(null);

  const sanitizeNextPath = (value) => {
    if (typeof value !== 'string') return '/';
    return value.startsWith('/') ? value : '/';
  };

  const handleProtectedClick = (e, requireLogin, nextHref) => {
    if (!requireLogin) return; // Not login required -> allow default navigation
    e.preventDefault();
    setPendingNext(nextHref);
    setShowLogin(true);
  };

  const handleLoginConfirm = async (username, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: username,
        password,
      });

      if (error) {
        return { error: "Invalid username or password." };
      }

      const target = sanitizeNextPath(pendingNext || "/");
      setPendingNext(null);
      setShowLogin(false);
      await router.push(target);
      return { ok: true };
    } catch (err) {
      return { error: err?.message || "Unable to log in right now." };
    }
  };

  // Fetch all blogs
  useEffect(() => {
    const fetchBlogs = async () => {
      setLoading(true);
      
      // Fetch technical blogs
      const { data: techBlogs, error: techError } = await supabase
        .from('Blogs')
        .select('*')
        .order('date', { ascending: false });

      if (techError) {
        console.error('Error fetching technical blogs:', techError);
      }

      // Fetch life blogs
      const { data: lifeBlogs, error: lifeError } = await supabase
        .from('life_blogs')
        .select('*')
        .order('created_at', { ascending: false });

      if (lifeError) {
        console.error('Error fetching life blogs:', lifeError);
      }

      // Combine and normalize blogs
      const normalizedTechBlogs = (techBlogs || []).map(blog => ({
        ...blog,
        blogType: 'technical',
        displayDate: blog.date,
        linkPath: `/blog-single/${blog.id}`
      }));

      const normalizedLifeBlogs = (lifeBlogs || []).map(blog => ({
        ...blog,
        blogType: 'life',
        displayDate: blog.published_at,
        linkPath: `/life-blog/${blog.id}`
      }));

      const combined = [...normalizedTechBlogs, ...normalizedLifeBlogs];
      setAllBlogs(combined);

      // Extract all unique tags
      const tagsSet = new Set();
      combined.forEach(blog => {
        if (blog.tags) {
          blog.tags.split(',').forEach(tag => {
            const trimmed = tag.trim();
            if (trimmed) tagsSet.add(trimmed);
          });
        }
      });
      setAllTags(Array.from(tagsSet).sort());

      setLoading(false);
    };

    fetchBlogs();
  }, []);

  // Handle URL query params for initial filter
  useEffect(() => {
    if (queryTag) {
      setSelectedTag(queryTag);
    }
    if (queryType && ['all', 'technical', 'life'].includes(queryType)) {
      setSelectedType(queryType);
    }
  }, [queryTag, queryType]);

  // Filter blogs based on selected filters
  useEffect(() => {
    let filtered = [...allBlogs];

    // Filter by type
    if (selectedType !== 'all') {
      filtered = filtered.filter(blog => blog.blogType === selectedType);
    }

    // Filter by tag
    if (selectedTag) {
      filtered = filtered.filter(blog => {
        if (!blog.tags) return false;
        const blogTags = blog.tags.split(',').map(t => t.trim().toLowerCase());
        return blogTags.includes(selectedTag.toLowerCase());
      });
    }

    setFilteredBlogs(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [allBlogs, selectedTag, selectedType]);

  // Get current page blogs
  const indexOfLastBlog = currentPage * itemsPerPage;
  const indexOfFirstBlog = indexOfLastBlog - itemsPerPage;
  const currentBlogs = filteredBlogs.slice(indexOfFirstBlog, indexOfLastBlog);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTagClick = (tag) => {
    if (selectedTag === tag) {
      setSelectedTag('');
      // Update URL without tag
      router.push({
        pathname: '/blogs',
        query: selectedType !== 'all' ? { type: selectedType } : {}
      }, undefined, { shallow: true });
    } else {
      setSelectedTag(tag);
      // Update URL with tag
      router.push({
        pathname: '/blogs',
        query: { 
          tag,
          ...(selectedType !== 'all' && { type: selectedType })
        }
      }, undefined, { shallow: true });
    }
  };

  const handleTypeChange = (type) => {
    setSelectedType(type);
    // Update URL
    router.push({
      pathname: '/blogs',
      query: {
        ...(selectedTag && { tag: selectedTag }),
        ...(type !== 'all' && { type })
      }
    }, undefined, { shallow: true });
  };

  const clearFilters = () => {
    setSelectedTag('');
    setSelectedType('all');
    router.push('/blogs', undefined, { shallow: true });
  };

  if (loading) return <div className="loading-container"><div>Loading...</div></div>;

  return (
    <>
      <SeoHead title="All Blogs" description="Browse all technical and life blogs" />
      <Layout>
        <section className="section section-inner started-heading">
          <div className="container">
            <div className="row">
              <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                <div className="h-titles">
                  <h1 className="h-title">All Blogs</h1>
                  <p className="subtitle">Technical insights and life adventures</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-inner m-archive">
          {/* Filter Section */}
          <div className="container">
            <div className="blog-filters">
              {/* Type Filter */}
              <div className="filter-group">
                <span className="filter-label">Type:</span>
                <div className="filter-buttons">
                  <button
                    className={`filter-btn ${selectedType === 'all' ? 'active' : ''}`}
                    onClick={() => handleTypeChange('all')}
                  >
                    All
                  </button>
                  <button
                    className={`filter-btn ${selectedType === 'technical' ? 'active' : ''}`}
                    onClick={() => handleTypeChange('technical')}
                  >
                    Technical
                  </button>
                  <button
                    className={`filter-btn ${selectedType === 'life' ? 'active' : ''}`}
                    onClick={() => handleTypeChange('life')}
                  >
                    Life
                  </button>
                </div>
              </div>

              {/* Tag Filter */}
              <div className="filter-group">
                <span className="filter-label">Tags:</span>
                <div className="tag-filters">
                  {allTags.map((tag, index) => (
                    <button
                      key={index}
                      className={`tag-btn ${selectedTag === tag ? 'active' : ''}`}
                      onClick={() => handleTagClick(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Filters & Clear */}
              {(selectedTag || selectedType !== 'all') && (
                <div className="active-filters">
                  <span>Active filters: </span>
                  {selectedType !== 'all' && (
                    <span className="filter-badge">{selectedType}</span>
                  )}
                  {selectedTag && (
                    <span className="filter-badge">{selectedTag}</span>
                  )}
                  <button className="clear-filters-btn" onClick={clearFilters}>
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* Results count */}
            <div className="results-count">
              Showing {filteredBlogs.length} blog{filteredBlogs.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Blog Grid */}
          <div className="blog-items blogs-grid">
            {currentBlogs.length > 0 ? (
              currentBlogs.map((blog) => {
                const requireLogin = blog.blogType === 'life' && blog.require_login;
                return (
                  <div className="archive-item" key={`${blog.blogType}-${blog.id}`}>
                    <div className="image">
                      <Link href={blog.linkPath} legacyBehavior>
                        <a onClick={(e) => handleProtectedClick(e, requireLogin, blog.linkPath)}>
                          <img src={blog.image_url} alt={blog.title} />
                        </a>
                      </Link>
                      <span className={`blog-type-badge ${blog.blogType}`}>
                        {blog.blogType === 'technical' ? 'Tech' : 'Life'}
                      </span>
                      {requireLogin && (
                        <span className="login-required-badge">🔒</span>
                      )}
                    </div>
                    <div className="desc">
                      <div className="category">
                        {blog.category}
                        <br />
                        <span>{blog.displayDate}</span>
                      </div>
                      <h3 className="title">
                        <Link href={blog.linkPath} legacyBehavior>
                          <a onClick={(e) => handleProtectedClick(e, requireLogin, blog.linkPath)}>
                            {blog.title}
                            {requireLogin && " (login required)"}
                          </a>
                        </Link>
                      </h3>
                      <div className="text">
                        <p>{blog.description}</p>
                        {/* Tags preview */}
                        {blog.tags && (
                          <div className="blog-tags-preview">
                            {blog.tags.split(',').slice(0, 3).map((tag, idx) => (
                              <span
                                key={idx}
                                className="tag-preview"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleTagClick(tag.trim());
                                }}
                              >
                                {tag.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="readmore">
                          <Link href={blog.linkPath} legacyBehavior>
                            <a 
                              className="lnk"
                              onClick={(e) => handleProtectedClick(e, requireLogin, blog.linkPath)}
                            >
                              {requireLogin ? 'Log in to read' : 'Read more'}
                            </a>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="no-results">
                <p>No blogs found matching your filters.</p>
                <button className="clear-filters-btn" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            )}
          </div>

          <Pagination
            totalItems={filteredBlogs.length}
            itemsPerPage={itemsPerPage}
            currentPage={currentPage}
            onPageChange={handlePageChange}
          />
        </section>

        <style jsx>{`
          .subtitle {
            color: #666;
            margin-top: 10px;
            font-size: 16px;
          }
          
          :global(body.dark-skin) .subtitle {
            color: #999;
          }
          
          .loading-container {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 400px;
            color: #333;
          }
          
          :global(body.dark-skin) .loading-container {
            color: #fff;
          }
          
          .blog-filters {
            margin-bottom: 30px;
            padding: 18px 20px;
            background: rgba(0, 0, 0, 0.03);
            border-radius: 10px;
            border: 1px solid rgba(0, 0, 0, 0.08);
          }
          
          :global(body.dark-skin) .blog-filters {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
          }
          
          .filter-group {
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
          }
          
          .filter-label {
            display: inline-flex;
            align-items: center;
            color: #333;
            font-weight: 600;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            min-width: 50px;
            height: 32px;
            line-height: 32px;
          }
          
          :global(body.dark-skin) .filter-label {
            color: #fff;
          }
          
          .filter-buttons {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
          }
          
          .filter-btn {
            padding: 6px 16px;
            background: transparent;
            border: 1px solid rgba(0, 0, 0, 0.2);
            color: #333;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 13px;
            height: 32px;
            line-height: 18px;
          }
          
          :global(body.dark-skin) .filter-btn {
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
          }
          
          .filter-btn:hover {
            border-color: #3d85c6;
            color: #3d85c6;
          }
          
          .filter-btn.active {
            background: #3d85c6;
            border-color: #3d85c6;
            color: #fff;
          }
          
          .tag-filters {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
          }
          
          .tag-btn {
            padding: 4px 12px;
            background: transparent;
            border: 1px solid rgba(0, 0, 0, 0.15);
            color: rgba(0, 0, 0, 0.7);
            border-radius: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 12px;
            height: 28px;
            line-height: 18px;
          }
          
          :global(body.dark-skin) .tag-btn {
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: rgba(255, 255, 255, 0.7);
          }
          
          .tag-btn:hover {
            border-color: #3d85c6;
            color: #3d85c6;
          }
          
          .tag-btn.active {
            background: rgba(61, 133, 198, 0.2);
            border-color: #3d85c6;
            color: #3d85c6;
          }
          
          .active-filters {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            padding-top: 12px;
            border-top: 1px solid rgba(0, 0, 0, 0.08);
            color: rgba(0, 0, 0, 0.6);
            font-size: 13px;
          }
          
          :global(body.dark-skin) .active-filters {
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.6);
          }
          
          .filter-badge {
            padding: 3px 10px;
            background: rgba(61, 133, 198, 0.2);
            color: #3d85c6;
            border-radius: 12px;
            font-size: 11px;
            height: 24px;
            line-height: 18px;
            display: inline-flex;
            align-items: center;
          }
          
          .clear-filters-btn {
            padding: 4px 12px;
            background: transparent;
            border: 1px solid rgba(200, 80, 80, 0.4);
            color: rgba(200, 80, 80, 0.9);
            border-radius: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 12px;
            height: 28px;
            line-height: 18px;
          }
          
          .clear-filters-btn:hover {
            background: rgba(200, 80, 80, 0.1);
            border-color: rgba(200, 80, 80, 0.6);
          }
          
          .results-count {
            color: rgba(0, 0, 0, 0.6);
            margin-bottom: 30px;
            font-size: 14px;
          }
          
          :global(body.dark-skin) .results-count {
            color: rgba(255, 255, 255, 0.6);
          }
          
          .blogs-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 25px;
            padding: 0 15px;
          }
          
          .blogs-grid :global(.archive-item) {
            padding: 0;
            margin-bottom: 0;
            min-height: auto;
            background: #f8f9fa;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          
          :global(body.dark-skin) .blogs-grid :global(.archive-item) {
            background: #222a36;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          }
          
          .blogs-grid :global(.archive-item:hover) {
            transform: translateY(-5px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
          }
          
          :global(body.dark-skin) .blogs-grid :global(.archive-item:hover) {
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
          }
          
          .blogs-grid :global(.archive-item .image) {
            position: relative;
            margin: 0;
            height: 180px;
            overflow: hidden;
          }
          
          .blogs-grid :global(.archive-item .image img) {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transform: none;
            transition: transform 0.4s ease;
          }
          
          .blogs-grid :global(.archive-item:hover .image img) {
            transform: scale(1.05);
          }
          
          .blogs-grid :global(.archive-item .image:before),
          .blogs-grid :global(.archive-item .image:after) {
            display: none;
          }
          
          .blog-type-badge {
            position: absolute;
            top: 12px;
            right: 12px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            z-index: 5;
          }
          
          .blog-type-badge.technical {
            background: rgba(61, 133, 198, 0.95);
            color: #fff;
          }
          
          .blog-type-badge.life {
            background: rgba(76, 175, 80, 0.95);
            color: #fff;
          }
          
          .blogs-grid :global(.archive-item .desc) {
            position: relative;
            padding: 20px;
            margin: 0;
            max-width: none;
          }
          
          .blogs-grid :global(.archive-item .desc .category) {
            position: relative;
            width: auto;
            text-align: left;
            font-size: 12px;
            font-weight: 500;
            color: #666;
            margin-bottom: 10px;
          }
          
          :global(body.dark-skin) .blogs-grid :global(.archive-item .desc .category) {
            color: #91959b;
          }
          
          .blogs-grid :global(.archive-item .desc .category span) {
            display: inline;
            padding-left: 8px;
            margin-left: 8px;
            border-left: 1px solid #999;
            font-size: 12px;
          }
          
          .blogs-grid :global(.archive-item .desc .category br) {
            display: none;
          }
          
          .blogs-grid :global(.archive-item .desc .title) {
            font-size: 18px;
            line-height: 1.4;
            margin-bottom: 12px;
            margin-left: 0;
          }
          
          .blogs-grid :global(.archive-item .desc .title a) {
            color: #222;
            text-decoration: none;
          }
          
          :global(body.dark-skin) .blogs-grid :global(.archive-item .desc .title a) {
            color: #fff;
          }
          
          .blogs-grid :global(.archive-item .desc .text) {
            margin-left: 0;
          }
          
          .blogs-grid :global(.archive-item .desc .text p) {
            font-size: 14px;
            line-height: 1.6;
            color: #555;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            margin: 0;
          }
          
          :global(body.dark-skin) .blogs-grid :global(.archive-item .desc .text p) {
            color: #aaa;
          }
          
          .blogs-grid :global(.archive-item .desc .readmore) {
            margin-top: 15px;
          }
          
          .blogs-grid :global(.archive-item .desc .readmore .lnk) {
            font-size: 13px;
            color: #3d85c6;
          }
          
          .blog-tags-preview {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin: 12px 0;
          }
          
          .tag-preview {
            padding: 3px 8px;
            background: rgba(0, 0, 0, 0.05);
            border: 1px solid rgba(0, 0, 0, 0.1);
            color: #555;
            border-radius: 10px;
            font-size: 10px;
            cursor: pointer;
            transition: all 0.3s ease;
          }
          
          :global(body.dark-skin) .tag-preview {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.6);
          }
          
          .tag-preview:hover {
            background: rgba(61, 133, 198, 0.15);
            border-color: #3d85c6;
            color: #3d85c6;
          }
          
          .no-results {
            grid-column: 1 / -1;
            text-align: center;
            padding: 60px 20px;
            color: #666;
          }
          
          :global(body.dark-skin) .no-results {
            color: rgba(255, 255, 255, 0.6);
          }
          
          .no-results p {
            margin-bottom: 20px;
            font-size: 16px;
          }

          @media (max-width: 768px) {
            .blogs-grid {
              grid-template-columns: 1fr;
              padding: 0 10px;
            }
            
            .blog-filters {
              padding: 20px 15px;
            }
            
            .filter-buttons {
              flex-direction: column;
            }
            
            .filter-btn {
              width: 100%;
              text-align: center;
            }
            
            .blogs-grid :global(.archive-item .image) {
              height: 160px;
            }
          }
          
          @media (min-width: 1200px) {
            .blogs-grid {
              grid-template-columns: repeat(3, 1fr);
            }
          }
          
          .login-required-badge {
            position: absolute;
            top: 12px;
            left: 12px;
            font-size: 16px;
            z-index: 6;
          }
        `}</style>
        
        {/* Login Dialog */}
        <LogInDialog
          open={showLogin}
          onClose={() => { setShowLogin(false); setPendingNext(null); }}
          onConfirm={handleLoginConfirm}
        />
      </Layout>
    </>
  );
};

export default Blogs;
