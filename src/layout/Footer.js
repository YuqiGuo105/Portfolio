const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL;
const LEETCODE_URL = process.env.NEXT_PUBLIC_LEETCODE_URL;
const INSTAGRAM_URL = process.env.NEXT_PUBLIC_INSTAGRAM_URL;

const Footer = () => {
  return (
    <div className="footer">
      <div className="footer__builder">
        <div className="container">
          <div className="row">
            <div className="col-xs-12 col-sm-12 col-md-4 col-lg-4 align-left">
              {/* social */}
              <div
                className="social-links"
              >
                <a target="_blank" rel="noreferrer" href={GITHUB_URL}>
                  <i aria-hidden="true" className="fab fa-github"/>
                </a>

                <a
                  target="_blank"
                  rel="noreferrer"
                  href={LEETCODE_URL}
                >
                  <i
                    aria-hidden="true"
                    className="leetcode-icon-bottom custom-leetcode-icon"
                  />
                </a>

                <a target="_blank" rel="noreferrer" href={INSTAGRAM_URL}>
                  <i aria-hidden="true" className="fab fa-instagram"/>
                </a>
              </div>
            </div>
            <div className="col-xs-12 col-sm-12 col-md-4 col-lg-4 align-center">
              <div
                className="copyright-text"
              >
                © 2023 <strong>Yuqi Guo's Blog</strong> All Rights Reserved
              </div>
            </div>
            <div className="col-xs-12 col-sm-12 col-md-4 col-lg-4 align-right">
              <div
                className="copyright-text"
              >
                Developed by <strong>Yuqi Guo</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default Footer;
