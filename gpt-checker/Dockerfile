# Chromium, its system libraries and Node come from Playwright's image; its version must match
# "playwright" in package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# A virtual screen for the headed browser, a window manager, and noVNC to see it from your browser.
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV DISPLAY=:99 NPM_CONFIG_UPDATE_NOTIFIER=false
EXPOSE 6080
ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "run", "check"]
