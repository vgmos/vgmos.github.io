---
layout: page
title: Notebook Index
permalink: /writing/index/
---

A chronological view of everything posted here.

<ul class="index-list">
  {% for post in site.posts %}
    <li>
      <span class="list-date">{{ post.date | date: "%Y" }}</span>
      <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
    </li>
  {% endfor %}
</ul>
