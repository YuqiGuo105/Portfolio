import Layout from "../../src/layout/Layout";
import { supabase } from '../../src/supabase/supabaseClient';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';

const BlogSingle = ({ postId }) => {
    const [blogContent, setBlogContent] = useState('');

    useEffect(() => {
        // Replace 'your_table_name' with your actual table name and adjust the ID as necessary
        const fetchBlogPost = async () => {
            const { data, error } = await supabase
                .from('Blogs')
                .select('content')
                .eq('id', 'your_blog_post_id') // Ensure you have a way to specify which post to fetch
                .single();

            if (error) {
                console.error('Error fetching blog post', error);
                return;
            }

            setBlogContent(data.content);
        };

        fetchBlogPost();
    }, []);

    return (
        <Layout extraWrapClass={"single-post"}>
            {/* Section Started Heading */}
            <section className="section section-inner started-heading">
                <div className="container">
                    <div className="row">
                        <div className="col-xs-12 col-sm-12 col-md-12 col-lg-12">
                            {/* titles */}
                            <div className="m-titles">
                                <h1
                                    className="m-title"
                                >
                                    Getting Started with Git and GitHub
                                </h1>
                                <div
                                    className="m-category"
                                >
                                    <a href="#" rel="category tag">
                                        Software Development
                                    </a>{" "}
                                    / November 28, 2023
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

                                    <p><strong>Mastering Git: Squash, Merge, Rebase, and Cherry-Pick for Conflict
                                        Resolution</strong></p>
                                    <p><strong>Git Basics</strong></p>
                                    <p>Before diving into the advanced operations, it's essential to understand the
                                        basic Git workflow. Git allows developers to create branches to isolate
                                        development work without affecting the main project (often referred to as the
                                        main or master branch). Changes made in branches can be integrated back into the
                                        main project through operations like merging and rebasing.</p>
                                    <p><strong>Squashing Commits</strong></p>
                                    <p>Squashing is the process of combining multiple commit messages into a single one.
                                        This is particularly useful for keeping the project's history clean and
                                        understandable.</p>

                                    <p>
                                        <img
                                            style={{display: 'block', marginLeft: 'auto', marginRight: 'auto'}}
                                            src="https://iyvhmpdfrnznxgyvvkvx.supabase.co/storage/v1/object/public/Blog/Git1.png"
                                            alt="" width="800" height="400"
                                        />
                                    </p>

                                    <p><strong>How to Squash Commits Using </strong><strong>git rebase</strong></p>
                                    <ol>
                                        <li>To start squashing commits, use git rebase in interactive mode (-i). For
                                            example, to squash the last three commits, you would use:
                                        </li>
                                    </ol>
                                    <table>
                                        <tbody>
                                        <tr>
                                            <td width="552">
                                                <p>Bash<br/> git rebase -i HEAD~3</p>
                                            </td>
                                        </tr>
                                        </tbody>
                                    </table>
                                    <ol>
                                        <li>In the interactive mode, you'll see a list of commits in your text editor.
                                            To squash commits, replace pick with squash next to the commits you want to
                                            combine.
                                        </li>
                                        <li>Save and close the editor. Git will then combine the selected commits into
                                            one. You'll be prompted to edit the new commit message.
                                        </li>
                                    </ol>
                                    <p><strong>Merging Branches</strong></p>
                                    <p>Merging is the process of integrating changes from one branch into another. It's
                                        a non-destructive operation that preserves the history of both branches.</p>
                                    <p><strong>Resolving Conflicts During a Merge</strong></p>
                                    <ol>
                                        <li>When conflicts arise during a merge, Git will pause the operation and mark
                                            the files that have conflicts.
                                        </li>
                                        <li>You can manually edit the files to resolve the conflicts. Git marks the
                                            conflicting areas in the files, so you can see the differences and decide
                                            which changes to keep.
                                        </li>
                                        <li>After resolving the conflicts, add the files with git add ., and complete
                                            the merge with git commit to create a new commit that includes the merged
                                            changes.
                                        </li>
                                    </ol>
                                    <p><strong>Rebasing Branches</strong></p>
                                    <p>Rebasing is another method to integrate changes from one branch into another.
                                        Unlike merging, rebasing rewrites the project history by applying changes from
                                        one branch onto another.</p>
                                    <p><strong>How to Rebase and Resolve Conflicts</strong></p>
                                    <ol>
                                        <li>Start the rebase with git rebase &lt;base-branch&gt;.</li>
                                        <li>If conflicts occur, Git will stop at the first problematic commit. Resolve
                                            the conflicts manually in the affected files.
                                        </li>
                                        <li>After fixing the conflicts, use git add . to stage the changes, and then git
                                            rebase --continue to proceed with the rebase.
                                        </li>
                                        <li>Repeat the process until all conflicts are resolved and the rebase is
                                            complete.
                                        </li>
                                    </ol>
                                    <p><strong>Cherry-Picking Commits</strong></p>
                                    <p>Cherry-picking allows you to select specific commits from one branch and apply
                                        them to another branch. This is useful for integrating specific changes without
                                        merging or rebasing entire branches.</p>

                                    <p>
                                        <img
                                            style={{display: 'block', marginLeft: 'auto', marginRight: 'auto'}}
                                            src="https://iyvhmpdfrnznxgyvvkvx.supabase.co/storage/v1/object/public/Blog/Git2.png"
                                            width="800"
                                            height="400"
                                        />
                                    </p>

                                    <p><strong>How to Cherry-Pick Commits</strong></p>
                                    <ol>
                                        <li>First, find the commit hash you want to cherry-pick. You can use git log to
                                            list commits.
                                        </li>
                                        <li>Then, switch to the branch where you want to apply the commit and run:</li>
                                    </ol>
                                    <table>
                                        <tbody>
                                        <tr>
                                            <td width="552">
                                                <p>Bash<br/> git cherry-pick &lt;commit-hash&gt;</p>
                                            </td>
                                        </tr>
                                        </tbody>
                                    </table>
                                    <p>If there are conflicts, resolve them in the same way as you would during a merge
                                        or rebase.</p>
                                    <p><strong>Best Practices for Conflict Resolution</strong></p>
                                    <ul>
                                        <li>Always pull the latest changes from the base branch before starting a merge,
                                            rebase, or cherry-pick to minimize conflicts.
                                        </li>
                                        <li>Prefer smaller, frequent commits and merges to reduce the complexity of
                                            conflicts.
                                        </li>
                                        <li>Communicate with your team when performing operations that affect shared
                                            branches to avoid overlapping work.
                                        </li>
                                    </ul>
                                    <span className="tags-links">
                    <span>Tags:</span>
                    <a href="#">GitHub</a>
                    <a href="#">Git</a>
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
