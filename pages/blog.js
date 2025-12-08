import Link from "next/link";
import Layout from "../src/layout/Layout";
import React, {useEffect, useMemo, useState} from 'react';
import {supabase} from '../src/supabase/supabaseClient'; // Ensure you have this file set up

// Pagination Component
const Pagination = ({totalItems, itemsPerPage, currentPage, onPageChange}) => {
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
        return null;
    }

    return (
        <div className="pager">
            {currentPage > 1 && (
                <a
                    className="prev page-numbers"
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        onPageChange(currentPage - 1);
                    }}
                >
                    <i className="icon-arrow"/> Prev
                </a>
            )}
            {Array.from({length: totalPages}, (_, i) => i + 1).map(page => (
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
                <a
                    className="next page-numbers"
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        onPageChange(currentPage + 1);
                    }}
                >
                    Next <i className="icon-arrow"/>
                </a>
            )}
        </div>
    );
};

const Blog = () => {
    const [allBlogs, setAllBlogs] = useState([]);
    const [lifeBlogs, setLifeBlogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(5); // Adjust as per your requirement
    const [totalItems, setTotalItems] = useState(0);
    const [tagInput, setTagInput] = useState('');
    const [activeTags, setActiveTags] = useState([]);

    const normaliseTag = (value) => value.trim().toLowerCase();

    const handleAddTag = () => {
        const tagToAdd = normaliseTag(tagInput);
        if (!tagToAdd || activeTags.includes(tagToAdd)) return;
        setActiveTags((prev) => [...prev, tagToAdd]);
        setTagInput('');
        setCurrentPage(1);
    };

    const handleRemoveTag = (tag) => {
        setActiveTags((prev) => prev.filter((item) => item !== tag));
        setCurrentPage(1);
    };

    useEffect(() => {
        const fetchBlogs = async () => {
            const [{data: techBlogs, error: techError}, {data: lifestyleBlogs, error: lifeError}] = await Promise.all([
                supabase
                    .from('Blogs')
                    .select('*')
                    .order('date', {ascending: false}),
                supabase
                    .from('life_blogs')
                    .select('id, title, image_url, category, published_at, description, require_login')
                    .order('created_at', {ascending: false}),
            ]);

            if (techError) {
                console.error('Error fetching blogs:', techError);
            } else {
                setAllBlogs(techBlogs ?? []);
            }

            if (lifeError) {
                console.error('Error fetching life blogs:', lifeError);
            } else {
                setLifeBlogs(lifestyleBlogs ?? []);
            }
            setLoading(false);
        };

        fetchBlogs();
    }, []);

    const filteredBlogs = useMemo(() => {
        if (activeTags.length === 0) return allBlogs;

        return allBlogs.filter((blog) => {
            const haystack = `${blog.category ?? ''} ${Array.isArray(blog.tags) ? blog.tags.join(' ') : ''}`.toLowerCase();
            return activeTags.every((tag) => haystack.includes(tag));
        });
    }, [activeTags, allBlogs]);

    useEffect(() => {
        setTotalItems(filteredBlogs.length);
        setCurrentPage((prev) => {
            const totalPages = Math.max(1, Math.ceil(filteredBlogs.length / itemsPerPage));
            return Math.min(prev, totalPages);
        });
    }, [filteredBlogs, itemsPerPage]);

    const paginatedBlogs = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        return filteredBlogs.slice(startIndex, endIndex);
    }, [currentPage, filteredBlogs, itemsPerPage]);

    const handlePageChange = (page) => {
        setCurrentPage(page);
        // Optionally, add logic to scroll to the top of the page or perform other actions
    };

    const handleTagKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddTag();
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <Layout>
            <section className="section section-inner started-heading">
                <div className="container">
                    <div className="row">
                        <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                            {/* titles */}
                            <div className="h-titles">
                                <h1
                                    className="h-title"
                                >
                                    My Blog Posts
                                </h1>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <section className="section section-inner m-archive">
                {/* Technical Blogs */}
                <div className="tag-filter">
                    <label className="tag-filter__label">Filter by tags</label>
                    <div className="tag-filter__controls">
                        <input
                            type="text"
                            className="tag-filter__input"
                            placeholder="Type a tag and press Enter"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleTagKeyDown}
                        />
                        <button type="button" className="btn" onClick={handleAddTag}>
                            Add tag
                        </button>
                    </div>
                    {activeTags.length > 0 && (
                        <div className="tag-filter__chips">
                            {activeTags.map((tag) => (
                                <span key={tag} className="tag-filter__chip">
                                    {tag}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${tag}`}
                                        onClick={() => handleRemoveTag(tag)}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                            <button
                                type="button"
                                className="tag-filter__clear"
                                onClick={() => setActiveTags([])}
                            >
                                Clear filters
                            </button>
                        </div>
                    )}
                </div>

                <h2 className="section-title">Technical Blogs</h2>
                <div className="blog-items">
                    {paginatedBlogs.length === 0 && (
                        <p>No blogs match the selected tags yet.</p>
                    )}
                    {paginatedBlogs.map((blog) => (
                        <div className="archive-item" key={blog.id}>
                            <div className="image">
                                <Link href={`/blog-single/${blog.id}`}>
                                    <a>
                                        <img src={blog.image_url} alt={blog.title}/>
                                    </a>
                                </Link>
                            </div>
                            <div className="desc">
                                <div
                                    className="category"
                                >
                                    {blog.category}
                                    <br/>
                                    <span>{blog.date}</span>
                                </div>
                                <h3
                                    className="title"
                                >
                                    <Link href={`/blog-single/${blog.id}`}>
                                        <a>{blog.title}</a>
                                    </Link>
                                </h3>
                                <div
                                    className="text"
                                >
                                    <p>
                                        {blog.description}
                                    </p>
                                    <div className="readmore">
                                        <Link href={`/blog-single/${blog.id}`}>
                                            <a className="lnk">Read more</a>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <Pagination
                    totalItems={totalItems}
                    itemsPerPage={itemsPerPage}
                    currentPage={currentPage}
                    onPageChange={handlePageChange}
                />

                <h2 className="section-title">Life Blogs</h2>
                <div className="blog-items">
                    {lifeBlogs.length === 0 && (
                        <p>No life blogs have been published yet.</p>
                    )}
                    {lifeBlogs.map((blog) => (
                        <div className="archive-item" key={blog.id}>
                            <div className="image">
                                <Link href={`/life-blog/${blog.id}`}>
                                    <a>
                                        <img src={blog.image_url} alt={blog.title}/>
                                    </a>
                                </Link>
                            </div>
                            <div className="desc">
                                <div
                                    className="category"
                                >
                                    {blog.category}
                                    <br/>
                                    <span>{blog.published_at}</span>
                                </div>
                                <h3
                                    className="title"
                                >
                                    <Link href={`/life-blog/${blog.id}`}>
                                        <a>{blog.title}</a>
                                    </Link>
                                </h3>
                                <div
                                    className="text"
                                >
                                    <p>
                                        {blog.description}
                                    </p>
                                    <div className="readmore">
                                        <Link href={`/life-blog/${blog.id}`}>
                                            <a className="lnk">Read more</a>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <style jsx>{`
                    .tag-filter {
                        margin-bottom: 24px;
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                    }

                    .tag-filter__controls {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: center;
                        gap: 12px;
                    }

                    .tag-filter__label {
                        font-weight: 600;
                    }

                    .tag-filter__input {
                        padding: 10px 12px;
                        border: 1px solid #e0e0e0;
                        border-radius: 8px;
                        min-width: 220px;
                        flex: 1;
                    }

                    .tag-filter__chips {
                        display: flex;
                        flex-wrap: wrap;
                        align-items: center;
                        gap: 8px;
                    }

                    .tag-filter__chip {
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        padding: 6px 10px;
                        border-radius: 999px;
                        background: #f3f3f3;
                        border: 1px solid #e5e5e5;
                    }

                    .tag-filter__chip button {
                        border: none;
                        background: transparent;
                        cursor: pointer;
                        font-size: 14px;
                    }

                    .tag-filter__clear {
                        background: none;
                        border: none;
                        color: inherit;
                        text-decoration: underline;
                        cursor: pointer;
                        padding: 0 4px;
                    }

                    .section-title {
                        margin: 32px 0 16px;
                        font-size: 24px;
                        font-weight: 700;
                    }
                `}</style>

            </section>
        </Layout>
    );
};
export default Blog;
