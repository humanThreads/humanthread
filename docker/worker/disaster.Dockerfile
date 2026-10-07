ARG STANDARD_IMAGE
ARG UNITY_RUNTIME_IMAGE

FROM ${UNITY_RUNTIME_IMAGE} AS unity
FROM ${STANDARD_IMAGE}

USER root
ARG APT_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
RUN sed -i \
    -e "s|https\?://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g" \
    /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    gdal-bin libgdal-dev libgdk-pixbuf-2.0-0 libglib2.0-0 libgl1 libglu1-mesa libgtk-3-0 libproj-dev libvulkan1 libxcursor1 mono-runtime proj-bin python3 python3-gdal xvfb \
  && rm -rf /var/lib/apt/lists/*

# UnityCI's Linux editor runtime lives at /opt/unity. Normalize it for the
# Worker image and fail the build rather than publishing an empty editor path.
COPY --from=unity /opt/unity /opt/Unity
RUN test -x /opt/Unity/Editor/Unity
ENV UNITY_HOME=/opt/Unity PATH=/opt/Unity/Editor:$PATH
USER humanthread
