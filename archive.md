---
layout: page
title: Blog Archive
permalink: /archive/
---

An older, chronological view of everything posted here.

<ul class="archive-list">
  {% for post in site.posts %}
    <li>
      <span class="list-date">{{ post.date | date: "%Y" }}</span>
      <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
      {% if post.tags %}
        <span class="list-tags">{{ post.tags | join: ", " }}</span>
      {% endif %}
    </li>
  {% endfor %}
</ul>
