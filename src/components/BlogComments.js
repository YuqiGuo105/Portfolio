import { useState, useEffect } from 'react';
import { supabase } from '../supabase/supabaseClient';

const BlogComments = ({ blogId, blogType }) => {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    content: ''
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');

  // Fetch comments
  useEffect(() => {
    if (!blogId) return;
    
    const fetchComments = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('blog_comments')
        .select('*')
        .eq('blog_id', blogId)
        .eq('blog_type', blogType)
        .eq('is_approved', true)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching comments:', error);
      } else {
        // Organize comments into threads
        const rootComments = data.filter(c => !c.parent_id);
        const replies = data.filter(c => c.parent_id);
        
        const commentsWithReplies = rootComments.map(comment => ({
          ...comment,
          replies: replies.filter(r => r.parent_id === comment.id)
        }));
        
        setComments(commentsWithReplies);
      }
      setLoading(false);
    };

    fetchComments();
  }, [blogId, blogType]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    
    if (!formData.content.trim()) {
      newErrors.content = 'Comment is required';
    } else if (formData.content.trim().length < 10) {
      newErrors.content = 'Comment must be at least 10 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle input change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  // Submit comment
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setSubmitting(true);
    setSuccessMessage('');
    
    const commentData = {
      blog_id: blogId,
      blog_type: blogType,
      author_name: formData.name.trim(),
      author_email: formData.email.trim(),
      content: formData.content.trim(),
      parent_id: replyingTo,
      is_approved: true // Set to false if you want moderation
    };

    const { data, error } = await supabase
      .from('blog_comments')
      .insert([commentData])
      .select()
      .single();

    if (error) {
      console.error('Error submitting comment:', error);
      setErrors({ submit: 'Failed to submit comment. Please try again.' });
    } else {
      // Add to comments list
      if (replyingTo) {
        setComments(prev => prev.map(comment => {
          if (comment.id === replyingTo) {
            return {
              ...comment,
              replies: [...(comment.replies || []), data]
            };
          }
          return comment;
        }));
      } else {
        setComments(prev => [...prev, { ...data, replies: [] }]);
      }
      
      // Reset form
      setFormData({ name: '', email: '', content: '' });
      setReplyingTo(null);
      setSuccessMessage('Your comment has been posted!');
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000);
    }
    
    setSubmitting(false);
  };

  // Cancel reply
  const cancelReply = () => {
    setReplyingTo(null);
    setFormData(prev => ({ ...prev, content: '' }));
  };

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Get initials for avatar
  const getInitials = (name) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="blog-comments-section">
      <div className="comments-header">
        <h3 className="comments-title">
          {comments.length} Comment{comments.length !== 1 ? 's' : ''}
        </h3>
      </div>

      {/* Comments List */}
      {loading ? (
        <div className="comments-loading">Loading comments...</div>
      ) : (
        <ul className="comments-list">
          {comments.map((comment) => (
            <li key={comment.id} className="comment-item">
              <div className="comment-box">
                <div className="comment-avatar">
                  {getInitials(comment.author_name)}
                </div>
                <div className="comment-body">
                  <div className="comment-meta">
                    <h5 className="comment-author">{comment.author_name}</h5>
                    <span className="comment-date">{formatDate(comment.created_at)}</span>
                  </div>
                  <p className="comment-content">{comment.content}</p>
                  <button 
                    className="reply-btn"
                    onClick={() => setReplyingTo(comment.id)}
                  >
                    Reply
                  </button>
                </div>
              </div>
              
              {/* Replies */}
              {comment.replies && comment.replies.length > 0 && (
                <ul className="replies-list">
                  {comment.replies.map((reply) => (
                    <li key={reply.id} className="comment-item reply">
                      <div className="comment-box">
                        <div className="comment-avatar small">
                          {getInitials(reply.author_name)}
                        </div>
                        <div className="comment-body">
                          <div className="comment-meta">
                            <h5 className="comment-author">{reply.author_name}</h5>
                            <span className="comment-date">{formatDate(reply.created_at)}</span>
                          </div>
                          <p className="comment-content">{reply.content}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          
          {comments.length === 0 && (
            <li className="no-comments">
              <p>No comments yet. Be the first to share your thoughts!</p>
            </li>
          )}
        </ul>
      )}

      {/* Comment Form */}
      <div className="comment-form-section">
        <h4 className="form-title">
          {replyingTo ? 'Leave a Reply' : 'Leave a Comment'}
        </h4>
        
        {replyingTo && (
          <div className="replying-to-notice">
            <span>Replying to a comment</span>
            <button onClick={cancelReply}>Cancel</button>
          </div>
        )}
        
        {successMessage && (
          <div className="success-message">{successMessage}</div>
        )}
        
        {errors.submit && (
          <div className="error-message">{errors.submit}</div>
        )}
        
        <form onSubmit={handleSubmit} className="comment-form">
          <div className="form-row">
            <div className="form-group">
              <input
                type="text"
                name="name"
                placeholder="Your Name *"
                value={formData.name}
                onChange={handleChange}
                className={errors.name ? 'error' : ''}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>
            
            <div className="form-group">
              <input
                type="email"
                name="email"
                placeholder="Your Email *"
                value={formData.email}
                onChange={handleChange}
                className={errors.email ? 'error' : ''}
              />
              {errors.email && <span className="field-error">{errors.email}</span>}
            </div>
          </div>
          
          <div className="form-group">
            <textarea
              name="content"
              placeholder="Write your comment here... *"
              rows="5"
              value={formData.content}
              onChange={handleChange}
              className={errors.content ? 'error' : ''}
            />
            {errors.content && <span className="field-error">{errors.content}</span>}
          </div>
          
          <button
            type="submit"
            className="submit-btn"
            disabled={submitting}
          >
            {submitting ? 'Posting...' : 'Post Comment'}
          </button>
        </form>
      </div>

      <style jsx>{`
        .blog-comments-section {
          margin-top: 60px;
          padding-top: 40px;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        :global(body.dark-skin) .blog-comments-section {
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .comments-header {
          margin-bottom: 30px;
        }

        .comments-title {
          font-size: 24px;
          font-weight: 600;
          color: #222;
          margin: 0;
        }
        
        :global(body.dark-skin) .comments-title {
          color: #fff;
        }

        .comments-loading {
          text-align: center;
          color: #666;
          padding: 40px 0;
        }
        
        :global(body.dark-skin) .comments-loading {
          color: rgba(255, 255, 255, 0.6);
        }

        .comments-list {
          list-style: none;
          padding: 0;
          margin: 0 0 40px 0;
        }

        .comment-item {
          margin-bottom: 25px;
        }

        .comment-box {
          display: flex;
          gap: 15px;
        }

        .comment-avatar {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3d85c6 0%, #2a5f8f 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 600;
          font-size: 16px;
          flex-shrink: 0;
        }

        .comment-avatar.small {
          width: 40px;
          height: 40px;
          font-size: 13px;
        }

        .comment-body {
          flex: 1;
          background: rgba(0, 0, 0, 0.03);
          padding: 20px;
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        
        :global(body.dark-skin) .comment-body {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .comment-meta {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 10px;
        }

        .comment-author {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #222;
        }
        
        :global(body.dark-skin) .comment-author {
          color: #fff;
        }

        .comment-date {
          font-size: 13px;
          color: #888;
        }
        
        :global(body.dark-skin) .comment-date {
          color: rgba(255, 255, 255, 0.5);
        }

        .comment-content {
          margin: 0;
          color: #444;
          line-height: 1.7;
        }
        
        :global(body.dark-skin) .comment-content {
          color: rgba(255, 255, 255, 0.8);
        }

        .reply-btn {
          background: none;
          border: none;
          color: #3d85c6;
          font-size: 13px;
          cursor: pointer;
          padding: 0;
          margin-top: 12px;
          transition: color 0.3s ease;
        }

        .reply-btn:hover {
          color: #5a9fd6;
        }

        .replies-list {
          list-style: none;
          padding: 0;
          margin: 15px 0 0 65px;
        }

        .reply .comment-body {
          background: rgba(61, 133, 198, 0.05);
        }

        .no-comments {
          text-align: center;
          padding: 40px 20px;
          color: #666;
          background: rgba(0, 0, 0, 0.02);
          border-radius: 12px;
        }
        
        :global(body.dark-skin) .no-comments {
          color: rgba(255, 255, 255, 0.5);
          background: rgba(255, 255, 255, 0.02);
        }

        .no-comments p {
          margin: 0;
        }

        .comment-form-section {
          background: rgba(0, 0, 0, 0.02);
          padding: 25px;
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        
        :global(body.dark-skin) .comment-form-section {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .form-title {
          font-size: 20px;
          font-weight: 600;
          color: #222;
          margin: 0 0 20px 0;
        }
        
        :global(body.dark-skin) .form-title {
          color: #fff;
        }

        .replying-to-notice {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(61, 133, 198, 0.1);
          padding: 12px 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          color: #3d85c6;
          font-size: 14px;
        }

        .replying-to-notice button {
          background: none;
          border: none;
          color: rgba(200, 80, 80, 0.9);
          cursor: pointer;
          font-size: 13px;
        }

        .success-message {
          background: rgba(76, 175, 80, 0.15);
          border: 1px solid rgba(76, 175, 80, 0.3);
          color: #2e7d32;
          padding: 12px 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          font-size: 14px;
        }
        
        :global(body.dark-skin) .success-message {
          color: #81c784;
        }

        .error-message {
          background: rgba(244, 67, 54, 0.15);
          border: 1px solid rgba(244, 67, 54, 0.3);
          color: #c62828;
          padding: 12px 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          font-size: 14px;
        }
        
        :global(body.dark-skin) .error-message {
          color: #ef5350;
        }

        .comment-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
        }

        .comment-form input,
        .comment-form textarea {
          width: 100%;
          padding: 14px 18px;
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.15);
          border-radius: 8px;
          color: #222;
          font-size: 15px;
          font-family: inherit;
          transition: all 0.3s ease;
        }
        
        :global(body.dark-skin) .comment-form input,
        :global(body.dark-skin) .comment-form textarea {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .comment-form input::placeholder,
        .comment-form textarea::placeholder {
          color: #999;
        }
        
        :global(body.dark-skin) .comment-form input::placeholder,
        :global(body.dark-skin) .comment-form textarea::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }

        .comment-form input:focus,
        .comment-form textarea:focus {
          outline: none;
          border-color: #3d85c6;
          background: rgba(61, 133, 198, 0.05);
        }

        .comment-form input.error,
        .comment-form textarea.error {
          border-color: rgba(244, 67, 54, 0.5);
        }

        .comment-form textarea {
          resize: vertical;
          min-height: 120px;
        }

        .field-error {
          color: #c62828;
          font-size: 12px;
          margin-top: 6px;
        }
        
        :global(body.dark-skin) .field-error {
          color: #ef5350;
        }

        .submit-btn {
          align-self: flex-start;
          padding: 10px 28px;
          background: linear-gradient(135deg, #3d85c6 0%, #2a5f8f 100%);
          border: none;
          border-radius: 25px;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          height: 40px;
          line-height: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(61, 133, 198, 0.4);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .form-row {
            grid-template-columns: 1fr;
          }

          .replies-list {
            margin-left: 30px;
          }

          .comment-form-section {
            padding: 20px;
          }
        }
      `}</style>
    </div>
  );
};

export default BlogComments;
