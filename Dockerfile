FROM node:20-bookworm-slim AS node-deps

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev


FROM gradle:8.9-jdk17 AS android-builder

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

ENV ANDROID_SDK_ROOT=/opt/android-sdk
RUN mkdir -p /opt/android-sdk/cmdline-tools \
    && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmdtools.zip \
    && unzip -q /tmp/cmdtools.zip -d /tmp/android-cmdline \
    && mv /tmp/android-cmdline/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
    && rm -rf /tmp/cmdtools.zip /tmp/android-cmdline

ENV PATH=${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}
RUN yes | sdkmanager --licenses >/dev/null \
    && sdkmanager --install "platforms;android-35" "build-tools;35.0.0"

WORKDIR /src
COPY android/ ./android/
WORKDIR /src/android
RUN gradle --no-daemon :app:assembleRelease


FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tzdata openjdk-17-jre-headless libc++1 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/iBotPeaches/Apktool/releases/download/v2.11.1/apktool_2.11.1.jar -o /opt/apktool.jar \
    && mkdir -p /opt/android-build-tools

COPY --from=android-builder /opt/android-sdk/build-tools/35.0.0/ /opt/android-build-tools/
COPY --from=android-builder /src/android/app/build/outputs/apk/release/app-release-unsigned.apk /app/server-assets/donggua-template.apk
COPY --from=node-deps /app/node_modules ./node_modules

COPY . .

RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/data

ENV PATH=/opt/android-build-tools:${PATH} \
    ANDROID_BUILD_TOOLS=/opt/android-build-tools \
    APKTOOL_JAR=/opt/apktool.jar \
    DB_PATH=/app/data/db.json

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
