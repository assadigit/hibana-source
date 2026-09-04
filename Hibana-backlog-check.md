
## ~~Working on it - Done~~

New fixes and improvements request, after finishing make sure they're all implemented, then deploy.

1. In each project setting page , currently we have a row of tabs:
```
<div class="detail-tabs" role="tablist" aria-label="بخش‌های پروژه">
    <button type="button" class="detail-tab is-active" role="tab" aria-selected="true" aria-controls="detail-activity" data-detail-tab="activity" tabindex="0">آخرین تغییرات</button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-problems" data-detail-tab="problems" tabindex="-1">مشکل‌ها <span class="detail-tab-count">0</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-notes" data-detail-tab="notes" tabindex="-1">یادداشت‌ها</button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-links" data-detail-tab="links" tabindex="-1">پیوندها <span class="detail-tab-count">0</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-media" data-detail-tab="media" tabindex="-1">اسکرین‌شات <span class="detail-tab-count">0</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-changelogs" data-detail-tab="changelogs" tabindex="-1">تغییرات <span class="detail-tab-count">0</span></button>
  </div>
```

I want the priority of tabs to be changes like this:

یادداشت ها > مشکلات > بک لاگ > پیوندها > اسکرین شات > آخرین تغییرات

and remove this function and tab : 
```
<button type="button" class="detail-tab is-active" role="tab" aria-selected="true" aria-controls="detail-changelogs" data-detail-tab="changelogs" tabindex="0">تغییرات <span class="detail-tab-count">0</span></button>
```

The tab of backlog must accept two input models: 
A) Entry as a list item like this : - Fix the CSS problems of the dashboard (when user add's new item lists, they will be automatically added in the backlog box of the project i mean here):

```
<div class="pd-col" data-status="planned">
            <div class="pd-col-head"><span class="pd-col-title">بک‌لاگ برنامه‌ریزی‌شده</span><span class="detail-tab-count" data-pd-count="planned" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="planned">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="planned" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="planned"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div>
```
B) Entry as a full backlog document : like a total and long document of backlog of what have to be done. 

Backlog page must have a history. so you know when was the latest backlog change/modification.
also backlog (in B method) must have title and content like this :

Backlog of V 12.1 
[content blah blah blah]

Also, change the term بک لاگ برنامه ریزی شده to برنامه آتی . everywhere you used term backlog turn it into برنامه آتی (Upcoming Plan)

in the tab of مشکل ها (IT'S EQUIVALENT OF HURDLES AND BUGS) WHEN USER ADD A NEW BUG/PROBLEM IT MUST BE AUTOMATICALLY ADDED TO IT'S CORRESPONDING BOX (I MEAN HERE)

```
<div class="pd-col" data-status="bug">
            <div class="pd-col-head"><span class="pd-col-title">باگ‌ها</span><span class="detail-tab-count" data-pd-count="bug" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="bug">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="bug" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="bug"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div>
```

Everywhere you used term bug , turn it to "Problems" "مشکلات"

Note: Not every idea, turns to be in the upcoming plans, they must be reviewed and seleted.
this is the philosophy of ideas , just raw creativity not necessarily an implementation plan.

the boxes here:

https://hibana.ir/board.html?project=7d92ec2b-b159-4fde-8700-1691bef34289

```
<div class="db-board" id="db-board"><div class="db-cols"><section class="db-col" data-col="idea"><header class="db-col-head"><span class="db-col-name">ایده‌های جدید</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="idea"><button type="button" class="db-add" data-add="idea">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="planned"><header class="db-col-head"><span class="db-col-name">بک‌لاگ برنامه‌ریزی‌شده</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="planned"><button type="button" class="db-add" data-add="planned">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="in_progress"><header class="db-col-head"><span class="db-col-name">در حال انجام</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="in_progress"><button type="button" class="db-add" data-add="in_progress">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="done"><header class="db-col-head"><span class="db-col-name">پیاده‌سازی‌شده</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="done"><button type="button" class="db-add" data-add="done">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="bug"><header class="db-col-head"><span class="db-col-name">باگ‌ها</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="bug"><button type="button" class="db-add" data-add="bug">＋ <span>افزودن کار</span></button></div></section></div></div>
```

and this page in general , must be full-width. also they must comply with the same color coding of this box (currently they are all grey)

```
<div class="pd-board-grid"><div class="pd-col" data-status="idea">
            <div class="pd-col-head"><span class="pd-col-title">ایده‌های جدید</span><span class="detail-tab-count" data-pd-count="idea" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="idea">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="idea" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="idea"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="planned">
            <div class="pd-col-head"><span class="pd-col-title">بک‌لاگ برنامه‌ریزی‌شده</span><span class="detail-tab-count" data-pd-count="planned" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="planned">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="planned" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="planned"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="in_progress">
            <div class="pd-col-head"><span class="pd-col-title">در حال انجام</span><span class="detail-tab-count" data-pd-count="in_progress" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="in_progress">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="in_progress" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="in_progress"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="done">
            <div class="pd-col-head"><span class="pd-col-title">پیاده‌سازی‌شده</span><span class="detail-tab-count" data-pd-count="done" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="done">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="done" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="done"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="bug">
            <div class="pd-col-head"><span class="pd-col-title">باگ‌ها</span><span class="detail-tab-count" data-pd-count="bug" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="bug">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="bug" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="bug"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div></div>
```


-------------
## ==Part 2  (ِDone)

In project's type (for example in پیشخوان پروژه ها) I want to have this types:

1. بررسی نشده : when the project idea is valid, but it's not reviewed yet.
2. در حال تحقیق et when the project idea is valid, and I am investigating of it, the value the feasibility
3. در انتظار اجرا : Idea is valid, it's investigated and planned, but not started yet.
4. در حال انجام: project is being actively worked on / developing / improving
5. توقف توسعه Either because project is mature and ripe enough, or I left the project and it became obsolete  
6. عملیاتی : Project is alive and working well.

The project boxes are too big , I mean this ones in dashboard:

In projects page (not project specific and dedicate page)
create and show 6 boxes , in full width style, so user can have a glance of all types of their project.

```
<div class="card kanban-card stat-kanban-card" draggable="true" data-project-id="7d92ec2b-b159-4fde-8700-1691bef34289" data-status="building" data-nav-url="/project.html?id=7d92ec2b-b159-4fde-8700-1691bef34289" title="برای تغییر وضعیت به جعبهٔ دیگر بکش">
              <strong>هیبانا</strong>
              <div class="muted small">51 دقیقه پیش <span class="tag-chip" style="background:#f6d3652e">Project management</span></div>
              <div class="stat-kanban-open"><a class="small" href="/project.html?id=7d92ec2b-b159-4fde-8700-1691bef34289">باز کردن <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a></div>
            </div>
```

They must only carry this items , with no wasted white space.

[   Project Button (go to project page) + Project Heading           ]
below project heading write this small meta data: last time updated

Also use much more pastel colors, they're still too saturated for my taste.

Another thing: we need to differentiate the distinction between Sparks (ideas) and projects. not all ideas are about creating a new project, and not all ideas are meant to be built. I think the current flow of the app, mixes this two terms together. Remember, only some ideas get's to be a project ,  it is like this :

A. A pure spark or idea > B. It might become a "unreviewed project idea" (phase 1 of project) > C. then it might become Investigated project idea > and the rest you know ... because I already explained:

. بررسی نشده : when the project idea is valid, but it's not reviewed yet.
2. در حال تحقیق et when the project idea is valid, and I am investigating of it, the value the feasibility
3. در انتظار اجرا : Idea is valid, it's investigated and planned, but not started yet.
4. در حال انجام: project is being actively worked on / developing / improving
5. توقف توسعه Either because project is mature and ripe enough, or I left the project and it became obsolete  
6. عملیاتی : Project is alive and working well.
   
   
In projects page, when user defines a project:

```
<article class="card project-card pc-wire" style="--pc-accent:#f6d365" id="project-9ca4a8d1-4b43-4583-aa7a-576804957fed" draggable="true" data-project-id="9ca4a8d1-4b43-4583-aa7a-576804957fed" data-status="building" data-menu-ok="">
    <div class="row title-meta spread pc-head">
      <span class="muted small pc-updated">به‌روزرسانی 2 ساعت پیش</span>
      <span class="badge badge-building"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"></path></svg>در حال ساخت</span>
    <div class="spark-menu"><button type="button" data-menu-open="" aria-haspopup="true" aria-label="More actions"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"></circle><circle cx="12" cy="12" r="1.7" fill="currentColor"></circle><circle cx="19" cy="12" r="1.7" fill="currentColor"></circle></svg></button><div class="spark-menu-pop" hidden=""><button type="button" data-card-edit="9ca4a8d1-4b43-4583-aa7a-576804957fed"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg><span>Edit</span></button><button type="button" class="danger" data-card-delete="9ca4a8d1-4b43-4583-aa7a-576804957fed"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Delete</span></button></div></div></div>
    <a href="/project.html?id=9ca4a8d1-4b43-4583-aa7a-576804957fed" class="project-title pc-title">خلاصه ساز کتاب</a>
    <p class="muted small clip-2 pc-desc">خلاصه سازی کتاب با کمک هوش مصنوعی</p>
    <i class="pc-corner" aria-hidden="true"></i>
  </article>
```


there is not enough space in the boxes to show the meta data correctly , for example
به روز رسانی دو ساعت پیش have caused the project state to become two lines. because there aren't enough space for all of them in same row, so there's a minor glitch between them.


In project's dedicate page , where user can select a new stage by clicking and selecting from this menu:

```
<select id="pd-stage" class="pd-stage-select" hx-patch="/api/projects/7d92ec2b-b159-4fde-8700-1691bef34289" hx-vals="js:{status: this.value}" hx-target="body" hx-swap="beforeend" hx-trigger="change">
          <option value="spark">ایده</option><option value="pending">در انتظار</option><option value="building" selected="">در حال ساخت</option><option value="working">در حال استفاده</option><option value="archived">بایگانی‌شده</option>
        </select>
```

when user chooses a new stage from the drop-down menu and clicks ذخیره , actually it doesn't affect the project stage and the app continues to show the previous stage. Like it doesn't register the new value of it. 

-----------------------------------

## ==Part 3  (doing==

- Adding a Super-admin backend dashboard. (only accessible for me, as the creator of Hibana)
- It must have this reports : A. Number of Users B. The latest activity time of all users C. Top 10 Users (in term of most activity) D. The email which each user is registered with and users' usernames.
- Ability to Ban/Remove users, Ability to temporary Ban users.
- Ability to send a custom Email for any user I want, with Hibana's logo attached on top of the mail like a sigil. 
- Ability to send Batch Emails to all users.
- Ability to see which part of the Hibana is most active and popular for users for example quick note function ? projects? ideas? to-do-list and quadrants?
- Ability to show current online users.
- Ability to backup/downloading the whole database of hibana manually. to store it locally. 
- Ability to backup the database of hibana by pushing into a private REPO in github, So if by any means, the data was deleted, we should have a very very recent back to restore it.
- Ability to send Reset Password email and instructions for users.

--------------
Phase 4) 

1. Make the grid of project states a carousel, with default to showing only three boxes( the rest are hidden behind carousel click)
   
   the 3 main states I need: در حال تحقیق - در انتظار اجرا - در حال انجام
hidden in carousel by default: بررسی نشده ، توقف توسعه، عملیاتی

```
<section class="dash-projects-section">
          <h2>پیشخوان پروژه‌ها</h2>
          <div class="stat-strip stat-boxes">
          <div class="stat stat-box" data-status="unreviewed">
          <div class="row spread">
            <span class="row"><span class="icon-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg></span> <b class="stat-count">۰</b> <span class="stat-label">بررسی نشده</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=unreviewed">مشاهده همه <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
            </span>
          </div>
          <div class="stat-kanban">
            <div class="kanban-empty muted">هنوز چیزی نیست</div>
          </div>
        </div><div class="stat stat-box" data-status="investigating">
          <div class="row spread">
            <span class="row"><span class="icon-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg></span> <b class="stat-count">۰</b> <span class="stat-label">در حال تحقیق</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=investigating">مشاهده همه <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
            </span>
          </div>
          <div class="stat-kanban">
            <div class="kanban-empty muted">هنوز چیزی نیست</div>
          </div>
        </div><div class="stat stat-box" data-status="awaiting">
          <div class="row spread">
            <span class="row"><span class="icon-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2"></rect><path d="M3.5 9.5h17M8 3v4M16 3v4"></path></svg></span> <b class="stat-count">۰</b> <span class="stat-label">در انتظار اجرا</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=awaiting">مشاهده همه <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
            </span>
          </div>
          <div class="stat-kanban">
            <div class="kanban-empty muted">هنوز چیزی نیست</div>
          </div>
        </div><div class="stat stat-box" data-status="doing">
          <div class="row spread">
            <span class="row"><span class="icon-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"></path></svg></span> <b class="stat-count">۲</b> <span class="stat-label">در حال انجام</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=doing">مشاهده همه <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
            </span>
          </div>
          <div class="stat-kanban">
            <div class="card kanban-card stat-kanban-card" draggable="true" data-project-id="7d92ec2b-b159-4fde-8700-1691bef34289" data-status="doing" data-nav-url="/project.html?id=7d92ec2b-b159-4fde-8700-1691bef34289" title="برای تغییر وضعیت به جعبهٔ دیگر بکش">
              <div class="row skc-row">
                <a class="skc-open" href="/project.html?id=7d92ec2b-b159-4fde-8700-1691bef34289" aria-label="باز کردن پروژه — هیبانا" title="باز کردن پروژه"><svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
                <strong class="skc-title">هیبانا</strong>
              </div>
              <div class="muted small skc-updated">1 ساعت پیش</div>
            </div><div class="card kanban-card stat-kanban-card" draggable="true" data-project-id="9ca4a8d1-4b43-4583-aa7a-576804957fed" data-status="doing" data-nav-url="/project.html?id=9ca4a8d1-4b43-4583-aa7a-576804957fed" title="برای تغییر وضعیت به جعبهٔ دیگر بکش">
              <div class="row skc-row">
                <a class="skc-open" href="/project.html?id=9ca4a8d1-4b43-4583-aa7a-576804957fed" aria-label="باز کردن پروژه — خلاصه ساز کتاب" title="باز کردن پروژه"><svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
                <strong class="skc-title">خلاصه ساز کتاب</strong>
              </div>
              <div class="muted small skc-updated">17 ساعت پیش</div>
            </div>
          </div>
        </div><div class="stat stat-box" data-status="halted">
          <div class="row spread">
            <span class="row"><span class="icon-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5v13M15 5.5v13"></path></svg></span> <b class="stat-count">۰</b> <span class="stat-label">توقف توسعه</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=halted">مشاهده همه <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
            </span>
          </div>
          <div class="stat-kanban">
            <div class="kanban-empty muted">هنوز چیزی نیست</div>
          </div>
        </div><div class="stat stat-box" data-status="operational">
          <div class="row spread">
            <span class="row"><span class="icon-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5s4.5 3 4.5 8c0 2.6-1.6 4.6-1.6 6.5h-5.8c0-1.9-1.6-3.9-1.6-6.5 0-5 4.5-8 4.5-8Z"></path><circle cx="12" cy="9.5" r="1.8"></circle><path d="M9.5 20.5h5"></path></svg></span> <b class="stat-count">۰</b> <span class="stat-label">عملیاتی</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=operational">مشاهده همه <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
            </span>
          </div>
          <div class="stat-kanban">
            <div class="kanban-empty muted">هنوز چیزی نیست</div>
          </div>
        </div>
          </div>
        </section>
```

2. Next to لیست کارها title I want today's calender date:
   
```
   <h2>لیست کارها</h2>
```

The calender date you've already implemented in to-do-list app is nice:
```
<div id="hdrDate" class="hdr-date" dir="rtl">دوشنبه<span class="hdr-date-sep">،</span>۹ شهریور<span class="hdr-date-sep">،</span>۱۴۰۵</div>
```
But without background keep it minimal. 

also make the calender in to-do-list page without background.

also آرشیو and همه وظایف must have no background (currently they have grey-esh background)

3. I want an option to delete a task even from archives record of tasks. so it disappears completely.
4. I want to be able to create and manage folders for my ideas, like "Domain Names" , "Project Ideas" etc. so they're better organized.
5. merge oval and circle shapes in canvas, if user hold shift it creates a perfect circle, if not holding shift, it can be an oval, add at least 64 px roundedness to rectangle ( I prefer modern and soft edge rectangle currently it's too edgy for my taste)
6. Add ability to add Sticky notes (copy it from the canvas) to برگه یادداشت page as well.
7. In mobile view, header must always be seen, currently mobile view doesnt always show header. (the logo)
8. In projects page, "https://hibana.ir/projects.html" I want a two row and 3 coloumn grid, that classifies projects based on their state, when clicked it shows the project with that state. so those boxes are shown in the main projects page. currently it shows the actual projects in the main page of projects which is not nice.
9. Everywhere we used the term "پیاده سازی شده" turn it to this new term "انجام شده"
10. Also move the box of مشکلات between ایده های جدید and برنامه های آتی (currently its after پیاده سازی شده)
11. change this wording for the tab "یادداشت ها" from this:
    
    ### جایی که ماندم

نقطه‌تعلیق — کجا متوقف شدی و از کجا شروع کن.

to this:

remove heading of جایی که ماندم remove description, in placeholder input , instead of writing this: 
"بنویس کجا گیر کردی، چه باید انجام شود..."
write this:
یک یادداشت سریع بنویس تا بعدا پیگیری کنی.

12. In farsi language, digits must be Farsi/persian numerals as well, currently digits are latin like this:
    - 14 ساعت پیش
instead they should be:

    ۱۴ ساعت پیش
12. in fullscreen board (eg. https://hibana.ir/board.html?project=7d92ec2b-b159-4fde-8700-1691bef34289)"
the background of boxes are filled with a grey/green bg, make it no background, make it more minimal

I mean these boxes:

```
<div class="db-cols"><section class="db-col" data-col="idea"><header class="db-col-head"><span class="db-col-name">ایده‌های جدید</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="idea"><button type="button" class="db-add" data-add="idea">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="planned"><header class="db-col-head"><span class="db-col-name">برنامه آتی</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="planned"><button type="button" class="db-add" data-add="planned">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="in_progress"><header class="db-col-head"><span class="db-col-name">در حال انجام</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="in_progress"><button type="button" class="db-add" data-add="in_progress">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="done"><header class="db-col-head"><span class="db-col-name">پیاده‌سازی‌شده</span><span class="detail-tab-count">۰</span></header><div class="db-col-body" data-colbody="done"><button type="button" class="db-add" data-add="done">＋ <span>افزودن کار</span></button></div></section><section class="db-col" data-col="bug"><header class="db-col-head"><span class="db-col-name">مشکلات</span><span class="detail-tab-count">۱</span></header><div class="db-col-body" data-colbody="bug"><article class="db-card st-bug" draggable="true" data-task-card="c4076f60-8174-4c06-87fa-7eb981dde5fa" data-status="bug"><div class="db-card-main"><span class="prio-dot prio-medium" title="medium"></span><span class="db-card-title">مشکل 1</span></div><span class="db-card-date muted small">۹ شهریور ۱۴۰۵</span></article><button type="button" class="db-add" data-add="bug">＋ <span>افزودن کار</span></button></div></section></div>
```

use the same style of boxes in project settings, i mean this:

```
<div class="pd-board-grid"><div class="pd-col" data-status="idea">
            <div class="pd-col-head"><span class="pd-col-title">ایده‌های جدید</span><span class="detail-tab-count" data-pd-count="idea" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="idea">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="idea" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="idea"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="planned">
            <div class="pd-col-head"><span class="pd-col-title">برنامه آتی</span><span class="detail-tab-count" data-pd-count="planned" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="planned">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="planned" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="planned"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="in_progress">
            <div class="pd-col-head"><span class="pd-col-title">در حال انجام</span><span class="detail-tab-count" data-pd-count="in_progress" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="in_progress">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="in_progress" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="in_progress"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="done">
            <div class="pd-col-head"><span class="pd-col-title">پیاده‌سازی‌شده</span><span class="detail-tab-count" data-pd-count="done" data-n="0">۰</span></div>
            <div class="pd-tasks" data-pd-tasks="done">
              
              
            </div>
            <form class="pd-quick-add" data-pd-addform="done" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="done"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div><div class="pd-col" data-status="bug">
            <div class="pd-col-head"><span class="pd-col-title">مشکلات</span><span class="detail-tab-count" data-pd-count="bug" data-n="1">۱</span></div>
            <div class="pd-tasks" data-pd-tasks="bug">
              <a class="pd-task st-bug" href="/board.html?project=7d92ec2b-b159-4fde-8700-1691bef34289&amp;task=c4076f60-8174-4c06-87fa-7eb981dde5fa" draggable="true" data-pd-task="c4076f60-8174-4c06-87fa-7eb981dde5fa" data-pd-status="bug" data-pd-created="2026-08-31T14:36:41.339Z">
                <span class="prio-dot prio-medium" title="medium"></span>
                <span class="pd-task-body">
                  <span class="pd-task-title">مشکل 1</span>
                  <span class="pd-task-meta">۹ شهریور ۱۴۰۵ · ۱۴:۳۶</span>
                </span>
              </a>
              
            </div>
            <form class="pd-quick-add" data-pd-addform="bug" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="bug"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div></div>
```

----------------------

Phase 5

1. Change the term پیشخوان پروژه ها to "پروژه ها"
2. Add a text link for the "پیشخوان پروژه ها" , like you did for the لیست کارها , i mean this link:
```
   <a class="small" href="/to-do-list">رفتن به لیست کارها <svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
```
Call it " رفتن به بخش پروژه ها"

3. Currently, items of یادداشت سریع has a lot of white space for each, make them more compact, also there is a close/remove button right now, when a note is connected to a project, add a checkmark button as well, for when user done that task/note. (so it remains on the project's  record of that note) there must be a difference between deleting a note and make that note done and fixed.
4. still there are Latin numerals in Farsi lang of the hibana, for example see this:
   <h3 style="margin-block-start:1.5rem">یادداشت‌های مرتبط (0)</h3>
   it must be :
   یادداشت‌های مرتبط (۰)

   
   5. currently the button of adding a new tag is not fixed position : 
```
<button type="button" class="chip pd-tag-add" data-tag-add=""><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> برچسب</button>
```
How i found out: I added a tag, then added another, the position of this button moved through between these two tags, this button must have a consistent and fixed position, regardless of user's behavior with tags (deleting - adding etc)


7. Also I want an overhaul of the sprint board, I want user to be able to define a new "SPRINT" then add items and categories for it, then user starts that sprint (which the board shows), and user continue that stop, whenever that sprint is ended, user must have a button to Finish that sprint successfully. 
8. avoid showing horizental scroll in the sprint as much as possible, for example when there is no data that requires a horizental scroll to cover them, it's not needed. for example sprint currently shows from this day to next 32 days, but the sprints are empty, so the scroll is not needed. instead of showing a constant horizental scroll, add some buttons in sprint board, which user can go back in time and see previous tasks and improvements.
9. These boxes are too low-height, add more height to them also add relevant icons for each of them:
   
```
   <a class="pglance-box" href="/projects.html?status=unreviewed&amp;view=cards" data-pglance="unreviewed" title="بررسی نشده">
      <span class="pglance-count">۰</span>
      <span class="pglance-label">بررسی نشده</span>
    </a>
```
```
<div id="project-list" hx-get="/api/projects" hx-trigger="load" hx-include="form.filters" hx-swap="innerHTML" hx-indicator="#list-loading" class=""><div class="pglance pglance-grid" role="group" aria-label="پروژه‌ها بر اساس نوع"><a class="pglance-box" href="/projects.html?status=unreviewed&amp;view=cards" data-pglance="unreviewed" title="بررسی نشده">
      <span class="pglance-count">۰</span>
      <span class="pglance-label">بررسی نشده</span>
    </a><a class="pglance-box" href="/projects.html?status=investigating&amp;view=cards" data-pglance="investigating" title="در حال تحقیق">
      <span class="pglance-count">۰</span>
      <span class="pglance-label">در حال تحقیق</span>
    </a><a class="pglance-box" href="/projects.html?status=awaiting&amp;view=cards" data-pglance="awaiting" title="در انتظار اجرا">
      <span class="pglance-count">۰</span>
      <span class="pglance-label">در انتظار اجرا</span>
    </a><a class="pglance-box" href="/projects.html?status=doing&amp;view=cards" data-pglance="doing" title="در حال انجام">
      <span class="pglance-count">۲</span>
      <span class="pglance-label">در حال انجام</span>
    </a><a class="pglance-box" href="/projects.html?status=halted&amp;view=cards" data-pglance="halted" title="توقف توسعه">
      <span class="pglance-count">۰</span>
      <span class="pglance-label">توقف توسعه</span>
    </a><a class="pglance-box" href="/projects.html?status=operational&amp;view=cards" data-pglance="operational" title="عملیاتی">
      <span class="pglance-count">۰</span>
      <span class="pglance-label">عملیاتی</span>
    </a></div></div>
```

10. app must remember users' preferences, for example if a user chose to see projects in "List" mode, it must always be shown in list mode instead of showing in cards or kanban.
11. remove this button from current main project's link i mean here:
    https://hibana.ir/projects.html
    
    because it's useless:
    
```
    <button type="button" class="ghost" id="bulk-toggle-btn" title="انتخاب" data-i18n-title="bulk.select" data-tooltip="انتخاب" data-i18n-tooltip="bulk.select">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3"></rect><path d="M7.4 12.4l3 3 6.2-6.2"></path></svg>
          <span data-i18n="bulk.select">انتخاب</span>
        </button>
```

12. consolidate view modes, and make them drop down I mean here :
```
    <div class="view-switch" role="tablist" aria-label="View">
          <button type="button" class="seg-btn active" data-view="grid" onclick="setView('grid')" data-i18n="view.grid">مرحله‌ها</button>
          <button type="button" class="seg-btn" data-view="cards" onclick="setView('cards')" data-i18n="view.cards">کارت‌ها</button>
          <button type="button" class="seg-btn" data-view="list" onclick="setView('list')" data-i18n="view.list">فهرست</button>
          <button type="button" class="seg-btn" data-view="sticky" onclick="setView('sticky')" data-i18n="view.sticky">یادداشت‌های چسبان</button>
          <button type="button" class="seg-btn" data-view="kanban" onclick="setView('kanban')" data-i18n="view.kanban">کانبان</button>
        </div>
```

make them drop-down menu : نمایش : 

Make the CTA of creating a new project, like other cta's , be consistent .

```
<button type="button" class="btn" data-projectquickadd="" title="پروژه جدید" data-i18n-title="fab.project">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path><path d="M12 11v4M10 13h4"></path></svg>
          <span data-i18n="fab.project">پروژه جدید</span>
        </button>
```

13. reduce the font size of latin text in quick note (sticky note) by 2 px , for example if it's 14 px make it 12 px.
14. reduce the font size of meta data of sticky note by 40%
```
<span class="small muted">یادداشت · ۲۱:۰۵</span>
```

15. When user hovers in the notes of quadrants for example this:
    
```
    <label class="dash-todo-check" data-task-complete="f812ea73-ba61-4e57-9480-09ef81c707df">
          <input type="checkbox" aria-label="انجام کار">
          <span data-task-title="f812ea73-ba61-4e57-9480-09ef81c707df">تهیه پیش نویس پروژه طراحی سایت خانه اندیشه</span>
        </label>
```

the circles of task progress must appear below that task, so user can change the state progress of that task, by circles i mean this:
```
<div class="prog-track st-untouched">
    <div class="prog-dot p-untouched p-active" onclick="setProgress(event,'f812ea73-ba61-4e57-9480-09ef81c707df',2,'untouched')" title="شروع نشده"></div>
    <div class="prog-dot p-inprog" onclick="setProgress(event,'f812ea73-ba61-4e57-9480-09ef81c707df',2,'in_progress')" title="در حال انجام"></div>
    <div class="prog-dot p-hold" onclick="setProgress(event,'f812ea73-ba61-4e57-9480-09ef81c707df',2,'on_hold')" title="معلق"></div>
    <span class="prog-lbl">شروع نشده</span>
  </div>
```

16. when adding something new into progress progression , I mean here
```
<div class="pd-col" data-status="idea">
            <div class="pd-col-head"><span class="pd-col-title">ایده‌های جدید</span><span class="detail-tab-count" data-pd-count="idea" data-n="1">۱</span></div>
            <div class="pd-tasks" data-pd-tasks="idea">
              
              
            <a class="pd-task st-idea" href="/board.html?project=9ca4a8d1-4b43-4583-aa7a-576804957fed&amp;task=24b1c73d-bc3b-4905-b578-5c1198376ae4" draggable="true" data-pd-task="24b1c73d-bc3b-4905-b578-5c1198376ae4" data-pd-status="idea" data-pd-created="2026-08-31T21:05:50.762Z"><span class="prio-dot prio-medium"></span><span class="pd-task-body"><span class="pd-task-title">اضافه کردن خروجی جزوه آموزشی</span><span class="pd-task-meta">۹ شهریور ۱۴۰۵ · ۲۱:۰۵</span></span></a></div>
            <form class="pd-quick-add" data-pd-addform="idea" hidden="">
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="عنوان کار">
              <button type="submit" class="ghost" aria-label="افزودن کار"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
            </form>
            <button type="button" class="pd-task-add" data-pd-add="idea"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg> افزودن کار</button>
          </div>
```
change the term from "افزودن کار +" to "افزودن +"

also when adding a new item, it has two buttons which is redundant, and only one of them actually adds that item!:

the one which is working, is the + button after you click " افزودن کار" but the button افزودن کار itself is not working. merge this buttons and make sure they work. 

17. remove the idea of choosing tag colors for projects. use consistent grey colors for all of them (like what is conventional in websites which have tag) also add a title for those tags such as "لیبل های پروژه" 
    

18. remove drop shadow effect from the text content of sticky notes .


------------
### Working it right now
## ==Phase 6==
1. I discovered that the برگه یادداشت page doesn't properly save the user's content written on it, Even after showing saved, i changed the page and came back to notebook and realized the date was lost. 
2. Currently, there are only some emojies available to choose for users as their quadrant box (to-do-list) symbol, make all standard emojies available for them to choose. (full library- with a search field to find emoji faster)
3. Like the projects, which we added a drop-down menu for the ways which projects can be seen by the user, we need the same drop-down menu for ideas page, with this options:
   کانبان - یادداشت های چسبان - فهرست - کارت ها

4.in navbar, move برگه یادداشت to be placed next to the بوم 
so from right to left we have this:
پیشخوان - لیست کارها - پروژه ها - ایده ها - بوم -برگه یادداشت - تقویم

5. currently when user hovers on the icon of light mode/ dark mode, the label of it (which appears on hover) is out of viewing frame of user so it's not readable and fully visible.
6. the quick notes, must only show maximum 2-3 lines of each note, if the text is longer user must click on it > then a modal pops up that shows the full note.
7. add a pre-cautionary procedure to make sure user's data won't get deleted/removed/vanished during our iterative improvements, last time in my improvements, many parts of the user's data was vanished, make sure it never happens again.
8. when user clicks on a note in to-do-list page, a box appears , which has لغو and ذخیره buttons, but the problem is that neither ذخیره nor لغو button doesn't work and aren't interactive. (user have to refresh to get out of that situation)

9. the color coding of progress of each task in to-do-list page is wrong , I mean here:
```
    <div class="prog-track st-untouched">
    <div class="prog-dot p-untouched p-active" onclick="setProgress(event,'cecb42fa-eb29-473d-8ca0-33fc1a8f3bfb',3,'untouched')" title="شروع نشده"></div>
    <div class="prog-dot p-inprog" onclick="setProgress(event,'cecb42fa-eb29-473d-8ca0-33fc1a8f3bfb',3,'in_progress')" title="در حال انجام"></div>
    <div class="prog-dot p-hold" onclick="setProgress(event,'cecb42fa-eb29-473d-8ca0-33fc1a8f3bfb',3,'on_hold')" title="معلق"></div>
    <span class="prog-lbl">شروع نشده</span>
  </div>
```

Proposed color coding: (pastel colors)


در حال انجام : Orange
معلق: Yellow
شروع نشده : Grey

10. In archives of tasks ( in to do list), user currently can remove tasks even for archive, but user is not able to delete archive of recurring test, add this option for recurring task as well.
11. in archive modal of the to-do-list tasks , we have this terms:
```
    <div class="arch-stats"><span class="arch-stat">Q2 روزانه: <b>۱</b></span><span class="arch-stat">Q1 فوری و با ارزش: <b>۰</b></span><span class="arch-stat">Q3 کارهای شخصی: <b>۰</b></span><span class="arch-stat">Q4 شخصی و احساسی: <b>۰</b></span><span class="arch-stat">کل: <b>۱</b></span></div>
```

Remove Q 1,  Q 2 , Q 3 , Q 4 from everywhere you see them. the concept of to-do-list boxes have changed dramatically , so they dont make sense anymore. 

12. make the width of all pages same width . add a setting for users to choose their page width , and add this : Standard (1366 px)  and Full-width
because currently there is inconsistencies between page-widths of different pages.

13. In adding a quick new task by clicking on this button:
```
    <button type="button" class="q-fab" onclick="showForm(2)" id="ab-2" aria-label="افزودن وظیفه" title="افزودن وظیفه" style="">＋</button>
```

add an option for user to set the label of that task. currently it's only available by clicking on بیشتر to see full modal of task creation.  

14.currently the progess state of tasks in to-do-list influences their container color (color-coded) I want same feature for the tasks which appear in the dashboard, they are all transparent background and doesnt follow this color coding rule. 

15. currently in https://hibana.ir/sparks.html
it shows:

هنوز پروژه‌ای نیست

اولین ایده‌ات را با دکمه ＋ بالا ثبت کن — اینجا امن می‌ماند تا وقتی برای ساختن آماده باشی.

instead it must show

هنوز ایده ای رو ثبت نکردی!
اولین ایده‌ات را ثبت کن، اینجا امن می‌ماند تا وقتی برای فرصت کنی به آن بپردازی. 

and make this CTA :
```
<button type="button" class="empty-state-cta btn" data-quickadd-open="">ایدهٔ جدید</button>
```
ثبت ایده جدید change the them to:

also instead of this icon :
```
<svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path><path d="M12 11v4M10 13h4"></path></svg>
```
use a bulb light svg representing an spark/idea

16. turn this term from project " <span class="stat-label">در انتظار اجرا</span>"  to در انتظار اقدام. 

-------------
## Phase 7 

1. When user clicks on to-do-list boxes to change the name and emoji of that box, user have to click a rather small and ugly button :
   
```
   <button type="submit" class="dash-style-save" aria-label="ذخیره نام"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3"></rect><path d="M7.4 12.4l3 3 6.2-6.2"></path></svg></button>
```
Remove this button and instead design something like this:

نام بخش : 
زیر عنوان:
نماد: [emoji picker]           ذخیره  - لغو

also make the drop shadow softer for this box:

```
<div class="dash-todo-style-pop" data-dash-style-pop="2">
                <form class="dash-todo-rename-form" data-dash-rename-form="2">
                  <label>نام<span class="row"><input name="name" value="روزانه" maxlength="60" required="" aria-label="نام بخش"><button type="submit" class="dash-style-save" aria-label="ذخیره نام"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3"></rect><path d="M7.4 12.4l3 3 6.2-6.2"></path></svg></button></span></label>
                  <label>زیرعنوان<span class="row"><input name="subtitle" value="" maxlength="120" aria-label="زیرعنوان بخش"></span></label>
                </form>
                <div class="dash-style-icons" role="group" aria-label="انتخاب نماد"><button type="button" class="dash-style-emoji is-selected dash-icon-open" data-dash-icon-open="2" data-current="💪" aria-label="انتخاب نماد — کتابخانهٔ کامل ایموجی" title="انتخاب نماد — کتابخانهٔ کامل ایموجی">💪</button></div>
              </div>
```

2. adding notes inside this page for a task is buggy: [https://hibana.ir/to-do-list]
it only allows you to add one note per task, when you click + to add more , it doesnt do anything (not responsive)

```
<div class="upd-panel open" id="upd-panel-f812ea73-ba61-4e57-9480-09ef81c707df">
    <div class="upd-list"><div class="upd-row" id="upd-d638a941-0010-4817-b885-48e46552fda1"><span class="upd-ts">2026-09-01</span><span class="upd-text">سلام</span><button class="upd-edit" onclick="startUpdEdit('d638a941-0010-4817-b885-48e46552fda1','f812ea73-ba61-4e57-9480-09ef81c707df',2)" title="ویرایش یادداشت">✏️</button><button class="upd-del" onclick="delUpdate('d638a941-0010-4817-b885-48e46552fda1','f812ea73-ba61-4e57-9480-09ef81c707df',2)" title="حذف">×</button></div></div>
    <div class="upd-add-row">
      <input class="upd-inp" id="upd-inp-f812ea73-ba61-4e57-9480-09ef81c707df" placeholder="ثبت یادداشت یا پیشرفت…" onkeydown="if(event.key==='Enter'){event.preventDefault();addUpdate('f812ea73-ba61-4e57-9480-09ef81c707df',2);}">
      <button class="upd-add-btn" onclick="addUpdate('f812ea73-ba61-4e57-9480-09ef81c707df',2)">+</button>
    </div>
  </div>
```

3. place the setting button "..." of tasks in boxes of dashboard, on top left (for RTL) and and top right for (LTR), make sure there is no wasted white space below the task progress switch, I mean here:
   
```
   <div class="prog-track st-inprog" data-dash-prog="f812ea73-ba61-4e57-9480-09ef81c707df"><button type="button" class="prog-dot p-untouched" data-prog-state="untouched" title="شروع نشده" aria-label="شروع نشده" aria-pressed=""></button><button type="button" class="prog-dot p-inprog p-active" data-prog-state="in_progress" title="در حال انجام" aria-label="در حال انجام" aria-pressed=""></button><button type="button" class="prog-dot p-hold" data-prog-state="on_hold" title="معلق" aria-label="معلق" aria-pressed=""></button><span class="prog-lbl">در حال انجام</span></div>
```

No too much white space between it and the edge of container ( a standard padding would suffice)

4. Make the content and font-size smaller for tasks in dashboard, so they take less space. less space= more tasks visible ,  I mean this for example:

`<span data-task-title="f812ea73-ba61-4e57-9480-09ef81c707df">تهیه پیش نویس پروژه طراحی سایت خانه اندیشه</span>

5. The containers of projects are too much rounded , I mean this, make them standard round (modern vibe):
```
   <div class="card kanban-card stat-kanban-card" draggable="true" data-project-id="7d92ec2b-b159-4fde-8700-1691bef34289" data-status="doing" data-nav-url="/project.html?id=7d92ec2b-b159-4fde-8700-1691bef34289" title="برای تغییر وضعیت به جعبهٔ دیگر بکش">
              <div class="row skc-row">
                <a class="skc-open" href="/project.html?id=7d92ec2b-b159-4fde-8700-1691bef34289" aria-label="باز کردن پروژه — هیبانا" title="باز کردن پروژه"><svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h15M13.5 6l6 6-6 6"></path></svg></a>
                <strong class="skc-title">هیبانا</strong>
              </div>
              <div class="muted small skc-updated">۲ ساعت پیش</div>
            </div>
```
   
   6. I want a decorative upgrade, when users' mouse hovers inside the container of  quick-notes, they box must change color to a more active color (grabs the eye, for example a pastel blue)
```
<section class="card notebook" id="notebook">
    <!-- View toggle is PURE CSS (radios + sibling selectors, 2026-08-25): works even if the
         cached app.js predates the feature — no JS needed to switch list ⇄ carousel ⇄ grid. -->
    <input type="radio" class="note-view-radio" name="note-view" id="nv-list" value="list" checked="">
    <input type="radio" class="note-view-radio" name="note-view" id="nv-sticky" value="sticky">
    <input type="radio" class="note-view-radio" name="note-view" id="nv-grid" value="grid">
    <input type="radio" class="note-size-radio" name="note-size" id="ns-s" value="s">
    <input type="radio" class="note-size-radio" name="note-size" id="ns-m" value="m" checked="">
    <input type="radio" class="note-size-radio" name="note-size" id="ns-l" value="l">
    <div class="row spread note-head">
      <h3 class="note-heading">یادداشت سریع</h3>
      <span class="row note-head-controls">
        <span class="note-size-seg" role="radiogroup" aria-label="اندازه">
          <label for="ns-s">کوچک</label>
          <label for="ns-m">متوسط</label>
          <label for="ns-l">بزرگ</label>
        </span>
        <span class="note-view-seg" role="radiogroup" aria-label="نما">
          <label for="nv-list">فهرست</label>
          <label for="nv-sticky">چسبان</label>
          <label for="nv-grid">شبکه</label>
        </span>
      </span>
    </div>
    <form class="row note-compose" hx-post="/api/notes" hx-target="#notebook" hx-swap="outerHTML" data-note-compose="">
      <label class="note-compose-label" for="note-compose-box">یادداشت جدید</label>
      <div class="seg" role="tablist" aria-label="حالت یادداشت">
        <button type="button" class="seg-btn active" data-note-mode="note" aria-pressed="true">یادداشت</button>
        <button type="button" class="seg-btn " data-note-mode="list" aria-pressed="false">فهرست</button>
      </div>
      <input type="hidden" name="kind" value="note">
      <!-- dir: FA UI pins RTL so the Farsi placeholder (and FA typing) lays out right-to-left
           (dir=auto falls back to LTR on the empty value in several engines — user report
           2026-09-02); EN keeps auto so mixed-language typing still works. -->
      <textarea class="note-compose-text" id="note-compose-box" name="content" rows="2" dir="rtl" placeholder="یادداشت را تایپ کن و اینتر را بزن" maxlength="20000" autocomplete="off"></textarea>
      <button type="submit" class="qa-btn" aria-label="افزودن" title="افزودن"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
      <ul class="note-draft" hidden=""></ul>
    </form>
    <div class="note-list">
      <div class="note-card" id="note-dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" data-kind="note" style="--note-color:#FFF59D">
      <div class="note-headbar">
      
      <button class="ghost danger icon-btn" data-note-delete="dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
    </div>
      <textarea class="note-text" name="content" rows="1" maxlength="20000" dir="auto" hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-trigger="change" hx-target="#notebook" hx-swap="outerHTML" style="height: 3px;">The Box is too big</textarea>
      <!-- Phase 6 item 6: the card clamps to 3 lines (app.css); data-note-open hands the
           full-note reader modal to app.js (long notes only — short ones keep click-to-edit). -->
      <div class="note-render markdown-body" dir="auto" data-note-open="dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" title="خواندن کامل یادداشت" role="button" tabindex="0"><p><span class="lat-run">The</span> <span class="lat-run">Box</span> <span class="lat-run">is</span> <span class="lat-run">too</span> <span class="lat-run">big</span></p></div>
      <div class="row spread note-footer">
        <span class="small muted note-meta">یادداشت · ۰۱:۵۳</span>
        <span class="row note-footer-right"><span class="note-color-picker" role="group" aria-label="رنگ یادداشت">
    <button type="button" class="color-dot dot-yellow active" hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;yellow&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="yellow" title="yellow" style="background:#FFF59D;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-green " hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;green&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="green" title="green" style="background:#BBF7D0;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-pink " hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;pink&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="pink" title="pink" style="background:#FBCFE8;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-blue " hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;blue&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="blue" title="blue" style="background:#BFDBFE;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button>
  </span>
        <button class="ghost danger icon-btn" data-note-delete="dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></span>
      </div>
      <div class="note-attach" id="attach-dbd73b4c-17b4-4a6e-98f4-50151e9af2d9"><button class="ghost small attach-btn" hx-get="/api/notes/attach-picker?note_id=dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-target="#attach-dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-swap="innerHTML" aria-label="اتصال به پروژه" title="اتصال به پروژه"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.2-1.2"></path></svg> <span class="small">اتصال</span></button></div>
    </div><div class="note-card" id="note-57de6f44-a7c7-428b-9c91-70467b5766c1" data-kind="note" style="--note-color:#FFF59D">
      <div class="note-headbar">
      
      <button class="ghost danger icon-btn" data-note-delete="57de6f44-a7c7-428b-9c91-70467b5766c1" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
    </div>
      <textarea class="note-text" name="content" rows="1" maxlength="20000" dir="auto" hx-patch="/api/notes/57de6f44-a7c7-428b-9c91-70467b5766c1" hx-trigger="change" hx-target="#notebook" hx-swap="outerHTML" style="height: 3px;">A SATA-to-USB adapter cable for optical drives (sometimes labeled "USB 2.0 to SATA optical drive adapter"). Cheap, ~€8–15 on Amazon/eBay. It has:

A SATA data connector (small, flat, L-shaped)
A SATA power connector (wider, flat)
A USB plug on the other end (some need USB power only, some come with a small external power adapter — optical drives can be power-hungry, especially while burning, so one with a separate power brick is more reliable than a purely USB-bus-powered one)

Alternatively, a 5.25" external optical drive enclosure works too, but is bulkier and pricier for no real benefit here.

Steps
Buy a SATA-to-USB optical drive adapter (search "SATA to USB optical drive adapter" — make sure it's SATA, not IDE, and ideally includes a power adapter, not just USB power).
Connect the SATA data + SATA power connectors from the adapter into the back of the DVR-S19LBK (same ports it used inside your old PC).
Plug in the adapter's power (either via USB or its own brick, depending on the model you buy).
Connect the USB end to your current PC.
Windows/macOS will detect it automatically as a normal DVD-RW drive — no drivers needed.

That's it — no firmware or software changes required, and all its original burning capabilities (DVD±R/RW, DVD-RAM, LabelFlash label burning) will keep working exactly as before.</textarea>
      <!-- Phase 6 item 6: the card clamps to 3 lines (app.css); data-note-open hands the
           full-note reader modal to app.js (long notes only — short ones keep click-to-edit). -->
      <div class="note-render markdown-body" dir="auto" data-note-open="57de6f44-a7c7-428b-9c91-70467b5766c1" title="خواندن کامل یادداشت" role="button" tabindex="0"><p>A <span class="lat-run">SATA-to-USB</span> <span class="lat-run">adapter</span> <span class="lat-run">cable</span> <span class="lat-run">for</span> <span class="lat-run">optical</span> <span class="lat-run">drives</span> (<span class="lat-run">sometimes</span> <span class="lat-run">labeled</span> &amp;<span class="lat-run">quot</span>;<span class="lat-run">USB</span> 2.0 <span class="lat-run">to</span> <span class="lat-run">SATA</span> <span class="lat-run">optical</span> <span class="lat-run">drive</span> <span class="lat-run">adapter</span>&amp;<span class="lat-run">quot</span>;). <span class="lat-run">Cheap</span>, ~€8–15 <span class="lat-run">on</span> <span class="lat-run">Amazon/eBay</span>. <span class="lat-run">It</span> <span class="lat-run">has</span>:</p>
<p>A <span class="lat-run">SATA</span> <span class="lat-run">data</span> <span class="lat-run">connector</span> (<span class="lat-run">small</span>, <span class="lat-run">flat</span>, <span class="lat-run">L-shaped</span>)<br>
A <span class="lat-run">SATA</span> <span class="lat-run">power</span> <span class="lat-run">connector</span> (<span class="lat-run">wider</span>, <span class="lat-run">flat</span>)<br>
A <span class="lat-run">USB</span> <span class="lat-run">plug</span> <span class="lat-run">on</span> <span class="lat-run">the</span> <span class="lat-run">other</span> <span class="lat-run">end</span> (<span class="lat-run">some</span> <span class="lat-run">need</span> <span class="lat-run">USB</span> <span class="lat-run">power</span> <span class="lat-run">only</span>, <span class="lat-run">some</span> <span class="lat-run">come</span> <span class="lat-run">with</span> a <span class="lat-run">small</span> <span class="lat-run">external</span> <span class="lat-run">power</span> <span class="lat-run">adapter</span> — <span class="lat-run">optical</span> <span class="lat-run">drives</span> <span class="lat-run">can</span> <span class="lat-run">be</span> <span class="lat-run">power-hungry</span>, <span class="lat-run">especially</span> <span class="lat-run">while</span> <span class="lat-run">burning</span>, <span class="lat-run">so</span> <span class="lat-run">one</span> <span class="lat-run">with</span> a <span class="lat-run">separate</span> <span class="lat-run">power</span> <span class="lat-run">brick</span> <span class="lat-run">is</span> <span class="lat-run">more</span> <span class="lat-run">reliable</span> <span class="lat-run">than</span> a <span class="lat-run">purely</span> <span class="lat-run">USB-bus-powered</span> <span class="lat-run">one</span>)</p>
<p><span class="lat-run">Alternatively</span>, a 5.25&amp;<span class="lat-run">quot</span>; <span class="lat-run">external</span> <span class="lat-run">optical</span> <span class="lat-run">drive</span> <span class="lat-run">enclosure</span> <span class="lat-run">works</span> <span class="lat-run">too</span>, <span class="lat-run">but</span> <span class="lat-run">is</span> <span class="lat-run">bulkier</span> <span class="lat-run">and</span> <span class="lat-run">pricier</span> <span class="lat-run">for</span> <span class="lat-run">no</span> <span class="lat-run">real</span> <span class="lat-run">benefit</span> <span class="lat-run">here</span>.</p>
<p><span class="lat-run">Steps</span><br>
<span class="lat-run">Buy</span> a <span class="lat-run">SATA-to-USB</span> <span class="lat-run">optical</span> <span class="lat-run">drive</span> <span class="lat-run">adapter</span> (<span class="lat-run">search</span> &amp;<span class="lat-run">quot</span>;<span class="lat-run">SATA</span> <span class="lat-run">to</span> <span class="lat-run">USB</span> <span class="lat-run">optical</span> <span class="lat-run">drive</span> <span class="lat-run">adapter</span>&amp;<span class="lat-run">quot</span>; — <span class="lat-run">make</span> <span class="lat-run">sure</span> <span class="lat-run">it</span>'s <span class="lat-run">SATA</span>, <span class="lat-run">not</span> <span class="lat-run">IDE</span>, <span class="lat-run">and</span> <span class="lat-run">ideally</span> <span class="lat-run">includes</span> a <span class="lat-run">power</span> <span class="lat-run">adapter</span>, <span class="lat-run">not</span> <span class="lat-run">just</span> <span class="lat-run">USB</span> <span class="lat-run">power</span>).<br>
<span class="lat-run">Connect</span> <span class="lat-run">the</span> <span class="lat-run">SATA</span> <span class="lat-run">data</span> + <span class="lat-run">SATA</span> <span class="lat-run">power</span> <span class="lat-run">connectors</span> <span class="lat-run">from</span> <span class="lat-run">the</span> <span class="lat-run">adapter</span> <span class="lat-run">into</span> <span class="lat-run">the</span> <span class="lat-run">back</span> <span class="lat-run">of</span> <span class="lat-run">the</span> <span class="lat-run">DVR-S19LBK</span> (<span class="lat-run">same</span> <span class="lat-run">ports</span> <span class="lat-run">it</span> <span class="lat-run">used</span> <span class="lat-run">inside</span> <span class="lat-run">your</span> <span class="lat-run">old</span> <span class="lat-run">PC</span>).<br>
<span class="lat-run">Plug</span> <span class="lat-run">in</span> <span class="lat-run">the</span> <span class="lat-run">adapter</span>'s <span class="lat-run">power</span> (<span class="lat-run">either</span> <span class="lat-run">via</span> <span class="lat-run">USB</span> <span class="lat-run">or</span> <span class="lat-run">its</span> <span class="lat-run">own</span> <span class="lat-run">brick</span>, <span class="lat-run">depending</span> <span class="lat-run">on</span> <span class="lat-run">the</span> <span class="lat-run">model</span> <span class="lat-run">you</span> <span class="lat-run">buy</span>).<br>
<span class="lat-run">Connect</span> <span class="lat-run">the</span> <span class="lat-run">USB</span> <span class="lat-run">end</span> <span class="lat-run">to</span> <span class="lat-run">your</span> <span class="lat-run">current</span> <span class="lat-run">PC</span>.<br>
<span class="lat-run">Windows/macOS</span> <span class="lat-run">will</span> <span class="lat-run">detect</span> <span class="lat-run">it</span> <span class="lat-run">automatically</span> <span class="lat-run">as</span> a <span class="lat-run">normal</span> <span class="lat-run">DVD-RW</span> <span class="lat-run">drive</span> — <span class="lat-run">no</span> <span class="lat-run">drivers</span> <span class="lat-run">needed</span>.</p>
<p><span class="lat-run">That</span>'s <span class="lat-run">it</span> — <span class="lat-run">no</span> <span class="lat-run">firmware</span> <span class="lat-run">or</span> <span class="lat-run">software</span> <span class="lat-run">changes</span> <span class="lat-run">required</span>, <span class="lat-run">and</span> <span class="lat-run">all</span> <span class="lat-run">its</span> <span class="lat-run">original</span> <span class="lat-run">burning</span> <span class="lat-run">capabilities</span> (<span class="lat-run">DVD</span>±<span class="lat-run">R/RW</span>, <span class="lat-run">DVD-RAM</span>, <span class="lat-run">LabelFlash</span> <span class="lat-run">label</span> <span class="lat-run">burning</span>) <span class="lat-run">will</span> <span class="lat-run">keep</span> <span class="lat-run">working</span> <span class="lat-run">exactly</span> <span class="lat-run">as</span> <span class="lat-run">before</span>.</p></div>
      <div class="row spread note-footer">
        <span class="small muted note-meta">یادداشت · ۲۰:۲۶</span>
        <span class="row note-footer-right"><span class="note-color-picker" role="group" aria-label="رنگ یادداشت">
    <button type="button" class="color-dot dot-yellow active" hx-patch="/api/notes/57de6f44-a7c7-428b-9c91-70467b5766c1" hx-vals="{&quot;color&quot;:&quot;yellow&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="yellow" title="yellow" style="background:#FFF59D;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-green " hx-patch="/api/notes/57de6f44-a7c7-428b-9c91-70467b5766c1" hx-vals="{&quot;color&quot;:&quot;green&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="green" title="green" style="background:#BBF7D0;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-pink " hx-patch="/api/notes/57de6f44-a7c7-428b-9c91-70467b5766c1" hx-vals="{&quot;color&quot;:&quot;pink&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="pink" title="pink" style="background:#FBCFE8;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-blue " hx-patch="/api/notes/57de6f44-a7c7-428b-9c91-70467b5766c1" hx-vals="{&quot;color&quot;:&quot;blue&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="blue" title="blue" style="background:#BFDBFE;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button>
  </span>
        <button class="ghost danger icon-btn" data-note-delete="57de6f44-a7c7-428b-9c91-70467b5766c1" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></span>
      </div>
      <div class="note-attach" id="attach-57de6f44-a7c7-428b-9c91-70467b5766c1"><button class="ghost small attach-btn" hx-get="/api/notes/attach-picker?note_id=57de6f44-a7c7-428b-9c91-70467b5766c1" hx-target="#attach-57de6f44-a7c7-428b-9c91-70467b5766c1" hx-swap="innerHTML" aria-label="اتصال به پروژه" title="اتصال به پروژه"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.2-1.2"></path></svg> <span class="small">اتصال</span></button></div>
    </div>
    </div>
    
  </section>
```

7. make the label chips smaller , also make their font colors less opacity, they are too obvious (big and too much attention grabbing) I mean these:
   
```
   <span class="chip pd-tag-chip">هوش مصنوعی</span>
```

also labels are too much (nearly collided) to each other, add some standard margin between them (just a lil bit)

8. Make the icons of project states 100% bigger. they're too small. I mean these:

```
<a class="pglance-box" href="/projects.html?status=unreviewed&amp;view=cards" data-pglance="unreviewed" title="بررسی نشده">
      <span class="pglance-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg></span>
      <span class="pglance-count">۰</span>
      <span class="pglance-label">بررسی نشده</span>
    </a>
```

9. currently in canvas we have a functional button called "تبدیل به ایده" i mean this:
```
   <button data-action="promote" title="تبدیل یادداشت انتخابی به ایده (یادداشت باقی می‌ماند)" data-i18n-title="canvas.promote"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0l-5 5m5-5l5 5"></path></svg> <span data-i18n="canvas.promoteBtn">تبدیل به ایده</span></button>
```

add another button like it , but for quick notes, what it does? when user write in a sticky note on canvas, when the sticky note is selected, if user click on "تبدیل به یادداشت" it will be added as quick note and can be seen in dashboard.

10. make the roundedness of rectangle tool in canvas, less. it's still too round for my taste.

11. for the quick-note containers , i mean here;
```
<div class="note-card" id="note-dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" data-kind="note" style="--note-color:#FFF59D">
      <div class="note-headbar">
      
      <button class="ghost danger icon-btn" data-note-delete="dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
    </div>
      <textarea class="note-text" name="content" rows="1" maxlength="20000" dir="auto" hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-trigger="change" hx-target="#notebook" hx-swap="outerHTML" style="height: 3px;">The Box is too big</textarea>
      <!-- Phase 6 item 6: the card clamps to 3 lines (app.css); data-note-open hands the
           full-note reader modal to app.js (long notes only — short ones keep click-to-edit). -->
      <div class="note-render markdown-body" dir="auto" data-note-open="dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" title="خواندن کامل یادداشت" role="button" tabindex="0"><p><span class="lat-run">The</span> <span class="lat-run">Box</span> <span class="lat-run">is</span> <span class="lat-run">too</span> <span class="lat-run">big</span></p></div>
      <div class="row spread note-footer">
        <span class="small muted note-meta">یادداشت · ۰۱:۵۳</span>
        <span class="row note-footer-right"><span class="note-color-picker" role="group" aria-label="رنگ یادداشت">
    <button type="button" class="color-dot dot-yellow active" hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;yellow&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="yellow" title="yellow" style="background:#FFF59D;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-green " hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;green&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="green" title="green" style="background:#BBF7D0;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-pink " hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;pink&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="pink" title="pink" style="background:#FBCFE8;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-blue " hx-patch="/api/notes/dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-vals="{&quot;color&quot;:&quot;blue&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="blue" title="blue" style="background:#BFDBFE;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button>
  </span>
        <button class="ghost danger icon-btn" data-note-delete="dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></span>
      </div>
      <div class="note-attach" id="attach-dbd73b4c-17b4-4a6e-98f4-50151e9af2d9"><button class="ghost small attach-btn" hx-get="/api/notes/attach-picker?note_id=dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-target="#attach-dbd73b4c-17b4-4a6e-98f4-50151e9af2d9" hx-swap="innerHTML" aria-label="اتصال به پروژه" title="اتصال به پروژه"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.2-1.2"></path></svg> <span class="small">اتصال</span></button></div>
    </div>
```

do this instruction:

**Technical instruction:** Decode HTML entities in the note text before rendering it, so escaped sequences such as `&quot;` display as the actual character instead of literal text. Unescape the string once at render time rather than each time it is saved, to avoid double-encoding.  
**Why:** The card is displaying the raw encoded entity instead of the character it represents — a mismatch between how the note is stored and how it is rendered.  
**Note:** This also affects screen readers, which read the literal entity name aloud instead of the intended punctuation.

**Technical instruction:** Change the note card's height from a fixed or minimum height to an automatic height that fits its content. Reduce the vertical gap between the note text and the bottom action row so it scales with the amount of text instead of staying constant regardless of note length.  
**Why:** The bottom row (delete button, timestamp, connection button) is currently anchored to the bottom of a container sized independently of the content — that mismatch is what creates the large empty gap on short notes.  
**Note:** If the delete button's diameter renders under about 44 px once spacing is tightened, increase it slightly to keep a comfortable tap target.

**Technical instruction:** Slightly increase the font size of the note body text (suggested: +2 px), and increase its line-height to match.  
**Why:** The note text is the card's primary content, but it currently reads smaller and lighter than the surrounding metadata and controls, which inverts the intended visual hierarchy.

**Technical instruction:** Darken the teal color used for the "اتصال" button's icon and text (suggested: `#1F6B70`, in place of the current lighter teal).  
**Why:** The current teal measures roughly 2.9:1 contrast against the card background, which fails the WCAG AA minimum of 3:1 for even large text and UI components — the button is not reliably legible.

**Technical instruction:** Convert the bottom action row's layout from physical left/right positioning to logical start/end positioning (`padding-inline-start/end`, `margin-inline-start/end`, or an equivalent logical flex arrangement). Mirror the row so it follows the interface's right-to-left reading direction instead of the current left-to-right arrangement.  
**Why:** The interface's labels and timestamps are Persian and read right-to-left, but the action row itself is still laid out left-to-right — logical properties make the row mirror automatically instead of needing separate RTL overrides.  
**Note:** Confirm the container's `dir` attribute or CSS `direction` property is also set to `rtl`.

**Technical instruction:** Add a visible "show more" control at the point where a note's text is truncated, instead of ending the text with a static ellipsis. Expand the full note text in place, or open it in a detail view, when the user activates that control.  
**Why:** The ellipsis currently signals that text is cut off, but there is no way to actually reach the rest of the note from this screen.

12. For the + cta in the dashboard, I mean this:
    
```
    <button class="fab" data-fab-toggle="" type="button" aria-expanded="false" aria-label="New" data-i18n-title="fab.new" title="جدید">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
    </button>
```

add a third option, called یادداشت سریع when user clicks on it, a modal pop's up , user writes the note in it, also there is اتصال button, which if user clicks they can connect it to a project. then ذخیره - لغو buttons if user hit ذخیره it will be saved in quick notes. 

13. I want a skeleton UI : 
Build a dedicated skeleton-state view for this screen that mirrors the current layout's exact grid: the top navigation bar, the Task List board, the Projects board, and the floating "+" button — matching each region's width, height, and position so nothing shifts once real content replaces it.
In the top navigation bar, replace the avatar with a small circle, and replace the username and each nav label with a short rounded-rectangle bar sized to roughly match its real label's width.
In each Task List column, replace the icon with a small rounded-rectangle, the column title with a medium rounded-rectangle, and the active-count label with a short rounded-rectangle. Add 1–2 full-width rounded-rectangle blocks inside the column body to stand in for task cards, even in columns that end up empty once loaded — the skeleton cannot know the real count in advance.
in each Projects column, replace the header label and count the same way, and add 2 full-width rounded-rectangle rows inside the body to stand in for project rows.
Replace the floating "+" button with a solid circle at the same size and fixed position, with no icon or animation inside it.
Apply one shared shimmer (or pulse) animation across all placeholder shapes, moving in the same direction at the same time, so the page reads as one coordinated loading state rather than separate components animating independently.
 Keep every skeleton block's corner radius, spacing, and alignment identical to the real component it replaces, including right-to-left ordering and right-aligned text blocks, since the interface is Persian/RTL.
Swap the skeleton for the real content in place once data finishes loading — the real components should render into the exact positions and sizes the skeleton blocks occupied, with no layout jump.

**Why:** A skeleton screen only shortens perceived wait time if its shapes and positions genuinely match the real layout — that's what "based on the actual skeleton of the website" means in practice: same grid, same block sizes, same spacing, just filled with placeholder shapes instead of content.

**Note:** Wrap the shimmer animation in a `prefers-reduced-motion` check and fall back to a static (non-animated) placeholder when that's set, since a moving shimmer across the full page can be uncomfortable for motion-sensitive users. This also assumes your stated stack — plain HTML/JS with Alpine.js, no build step — from your app spec; if that's changed, flag it, since the mechanism (e.g. an `x-show` / `x-if` flag toggling between the skeleton markup and the real markup once data resolves) depends on it.

--------------

## ==Phase 7== 

1. Ability to define Folders/Categories for the ideas, so they're not spread and scattered into each other. for example , Business Ideas , Product Ideas. 

2. adding new features and capabilities between Hibana and telegram bot, like updating projects, adding something new to projects, adding a new idea, adding a new quick note, seeing the current to-do-list items
3. The latest quick note must come at top. Top quick note : the latest one , last quick note: oldest
4. The container of quicknotes are still too bulky and too much white space make it more streamlined and compact. I mean this:

```
<div class="note-card" id="note-fc48ea28-075a-4d07-af10-c02f592460bd" data-kind="note" style="--note-color:#FFF59D"> <div class="note-headbar"> <button class="ghost danger icon-btn" data-note-delete="fc48ea28-075a-4d07-af10-c02f592460bd" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button> </div> <textarea class="note-text" name="content" rows="1" maxlength="20000" dir="auto" hx-patch="/api/notes/fc48ea28-075a-4d07-af10-c02f592460bd" hx-trigger="change" hx-target="#notebook" hx-swap="outerHTML" style="height: 3px;">ادامه توسعه هیبانا (فازهای بعدی - هنوز در ابسیدین نوشته نشده)</textarea> <!-- Phase 6 item 6: the card clamps to 3 lines (app.css); data-note-open hands the full-note reader modal to app.js (long notes only — short ones keep click-to-edit). Phase 7 item 11: the «بیشتر…» chip is revealed by app.js (.has-more) exactly when the clamp actually truncates — a visible control at the cut point, not a dead ellipsis. --> <div class="note-render markdown-body" dir="auto" data-note-open="fc48ea28-075a-4d07-af10-c02f592460bd" title="خواندن کامل یادداشت" role="button" tabindex="0"><p>ادامه توسعه هیبانا (فازهای بعدی - هنوز در ابسیدین نوشته نشده)</p></div> <button type="button" class="note-more" data-note-more="fc48ea28-075a-4d07-af10-c02f592460bd" hidden="">بیشتر…</button> <div class="row spread note-footer"> <span class="small muted note-meta">یادداشت · ۰۲:۳۶</span> <span class="row note-footer-right"><span class="note-color-picker" role="group" aria-label="رنگ یادداشت"> <button type="button" class="color-dot dot-yellow active" hx-patch="/api/notes/fc48ea28-075a-4d07-af10-c02f592460bd" hx-vals="{&quot;color&quot;:&quot;yellow&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="yellow" title="yellow" style="background:#FFF59D;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-green " hx-patch="/api/notes/fc48ea28-075a-4d07-af10-c02f592460bd" hx-vals="{&quot;color&quot;:&quot;green&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="green" title="green" style="background:#BBF7D0;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-pink " hx-patch="/api/notes/fc48ea28-075a-4d07-af10-c02f592460bd" hx-vals="{&quot;color&quot;:&quot;pink&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="pink" title="pink" style="background:#FBCFE8;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button><button type="button" class="color-dot dot-blue " hx-patch="/api/notes/fc48ea28-075a-4d07-af10-c02f592460bd" hx-vals="{&quot;color&quot;:&quot;blue&quot;}" hx-target="#notebook" hx-swap="outerHTML" aria-label="blue" title="blue" style="background:#BFDBFE;width:0.9rem;height:0.9rem;border-radius:50%;padding:0;border:1px solid rgb(0 0 0 / 0.18)"></button> </span> <button class="ghost danger icon-btn" data-note-delete="fc48ea28-075a-4d07-af10-c02f592460bd" aria-label="حذف"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></span> </div> <div class="note-attach" id="attach-fc48ea28-075a-4d07-af10-c02f592460bd"><button class="ghost small attach-btn" hx-get="/api/notes/attach-picker?note_id=fc48ea28-075a-4d07-af10-c02f592460bd" hx-target="#attach-fc48ea28-075a-4d07-af10-c02f592460bd" hx-swap="innerHTML" aria-label="اتصال به پروژه" title="اتصال به پروژه"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.2-1.2"></path></svg> <span class="small">اتصال</span></button></div> </div>
```

