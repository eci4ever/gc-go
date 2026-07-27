CREATE UNIQUE INDEX members_organization_user_idx
    ON members (organization_id, user_id);

CREATE UNIQUE INDEX organizations_slug_lower_idx
    ON organizations (lower(slug));
