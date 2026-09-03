function prepareLinkGroupUrls(links) {
  if (!Array.isArray(links) || links.length === 0) {
    throw new TypeError("At least one link is required");
  }

  const preparedLinks = links.map((candidate) => {
    if (typeof candidate !== "string") {
      return null;
    }

    const trimmed = candidate.trim();

    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
    } catch (urlError) {
      return null;
    }
  });

  if (preparedLinks.some((link) => !link)) {
    throw new TypeError("Only HTTP(S) links can be opened");
  }

  return preparedLinks;
}

module.exports = { prepareLinkGroupUrls };
