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
                <a target="_blank" rel="noreferrer" href="https://www.linkedin.com/in/yuqi-g-185957355/">
                  <i aria-hidden="true" className="fab fa-linkedin"/>
                </a>
                <a target="_blank" rel="noreferrer" href="https://github.com/YuqiGuo105">
                  <i aria-hidden="true" className="fab fa-github"/>
                </a>

                <a
                  target="_blank"
                  rel="noreferrer"
                  href="https://leetcode.com/u/Yuqi_Guo/"
                >
                  <i
                    aria-hidden="true"
                    className="leetcode-icon-bottom custom-leetcode-icon"
                  />
                </a>

                <a target="_blank" rel="noreferrer" href="https://www.instagram.com/yuqi_guo17/">
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
