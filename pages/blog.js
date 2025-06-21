import Link from "next/link";
import Layout from "../src/layout/Layout";
import React, {useState, useEffect} from 'react';
import {supabase} from '../src/supabase/supabaseClient'; // Ensure you have this file set up
import { useTranslation } from '../src/context/TranslationContext';

// Pagination Component
const Pagination = ({totalItems, itemsPerPage, currentPage, onPageChange}) => {
    const { t } = useTranslation();
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    return (
        <div className="pager">
            {currentPage > 1 && (
                <a className="prev page-numbers" href="#" onClick={() => onPageChange(currentPage - 1)}>
                    <i className="icon-arrow"/> {t('prev')}
                </a>
            )}
            {Array.from({length: totalPages}, (_, i) => i + 1).map(page => (
                <a key={page} href="#" className={`page-numbers ${page === currentPage ? 'current' : ''}`}
                   onClick={(e) => {
                       e.preventDefault();
                       onPageChange(page);
                   }}>
                    {page}
                </a>
            ))}
            {currentPage < totalPages && (
                <a className="next page-numbers" href="#" onClick={() => onPageChange(currentPage + 1)}>
                    {t('next')} <i className="icon-arrow"/>
                </a>
            )}
        </div>
    );
};

const Blog = () => {
    const { t } = useTranslation();
    const [blogs, setBlogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(5); // Adjust as per your requirement
    const [totalItems, setTotalItems] = useState(0);

    useEffect(() => {
        const fetchBlogs = async () => {
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage - 1;

            let {data, error, count} = await supabase
                .from('Blogs')
                .select('*', {count: 'exact'})
                .range(startIndex, endIndex);

            if (error) {
                console.error('Error fetching blogs:', error);
            } else {
                setBlogs(data);
                setTotalItems(count);
            }
            setLoading(false);
        };

        fetchBlogs();
    }, [currentPage, itemsPerPage]);

    const handlePageChange = (page) => {
        setCurrentPage(page);
        // Optionally, add logic to scroll to the top of the page or perform other actions
    };

    if (loading) return <div>{t('loading')}</div>;

    return (
        <Layout>
            <section className="section section-inner started-heading">
                <div className="container">
                    <div className="row">
                        <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                            {/* titles */}
                            <div className="h-titles">
                                <h1 className="h-title">{t('my_technical_blogs')}</h1>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <section className="section section-inner m-archive">
                {/* Blog */}
                <div className="blog-items">
                    {blogs.map((blog) => (
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
                                            <a className="lnk">{t('read_more')}</a>
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

            </section>
        </Layout>
    );
};
export default Blog;
