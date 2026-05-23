import posts from "../../../posts.json";
import Newsletter from "./Newsletter";

interface Post {
  id: number;
  title: string;
  date: string;
  excerpt: string;
}

export default function Home() {
  const list = posts as Post[];
  return (
    <main>
      <h1>The blog</h1>
      <ul className="posts">
        {list.map((post) => (
          <li key={post.id} className="card">
            <h2>{post.title}</h2>
            <time dateTime={post.date}>{post.date}</time>
            <p>{post.excerpt}</p>
          </li>
        ))}
      </ul>
      <Newsletter />
    </main>
  );
}
