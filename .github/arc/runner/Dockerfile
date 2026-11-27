FROM ghcr.io/frappe/suite-actions-runner:2.338.2@sha256:198f70ba05ccc518ec227659e4a91b0eff59c49f0e61351bc17e63d77f72747d

USER runner
ARG PILOT_VERSION=v1.0.0-rc.5
RUN curl -fsSL https://raw.githubusercontent.com/frappe/pilot/develop/install.sh \
    | sh -s -- --ci --version "$PILOT_VERSION"
ENV PATH="/home/runner/pilot/bin:/home/runner/.local/bin:${PATH}"
RUN pilot --version
