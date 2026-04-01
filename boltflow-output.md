flowchart LR

  classDef rootStyle      fill:#FA5252,stroke:#c0392b,color:#fff,font-weight:bold
  classDef componentStyle fill:#1976D2,stroke:#1565C0,color:#fff
  classDef serviceStyle   fill:#FFCA28,stroke:#F9A825,color:#333
  classDef directiveStyle fill:#AB47BC,stroke:#7B1FA2,color:#fff
  classDef pipeStyle      fill:#00897B,stroke:#00695C,color:#fff
  classDef guardStyle     fill:#43A047,stroke:#2E7D32,color:#fff
  classDef moduleStyle    fill:#FA5252,stroke:#c0392b,color:#fff

  cmp_1([AppComponent])
  cmp_2[AdminComponent]
  cmp_3[DashboardComponent]
  cmp_4[NotFoundComponent]
  cmp_5[ProfileComponent]
  cmp_6[SettingsComponent]
  cmp_7[AdminDashboardComponent]
  cmp_8[AdminUserDetailComponent]
  cmp_9[AdminUsersComponent]
  cmp_10[CatalogCardComponent]
  cmp_11[CatalogCompareComponent]
  cmp_12[CatalogHomeComponent]
  cmp_13[CatalogItemComponent]
  cmp_14[ProductDetailComponent]
  cmp_15[ProductEditComponent]
  cmp_16[ProductListComponent]
  cmp_17[ProductListItemComponent]
  cmp_18[ProductNewComponent]
  cmp_19[StatCardComponent]
  cmp_20[UserCardComponent]
  svc_1[(AuthService)]
  svc_2[(CatalogService)]
  svc_3[(FeatureService)]
  svc_4[(NotificationService)]
  svc_5[(ProductService)]
  svc_6[(RoleService)]
  svc_7[(UserService)]
  dir_1[/HighlightDirective\]
  dir_2[/TooltipDirective\]
  pipe_1[\CurrencyFormatPipe/]
  pipe_2[\TruncatePipe/]
  guard_1{AuthGuard}
  guard_2{FeatureFlagGuard}
  guard_3{ProductExistsGuard}
  guard_4{RoleGuard}
  guard_5{SuperAdminGuard}
  guard_6{UnsavedChangesGuard}
  lazy_products[[ProductsModule]]
  lazy_catalog[[CatalogModule]]

  cmp_1 -->|"/dashboard · canActivate: AuthGuard"| cmp_3
  cmp_1 -.->|"/products · lazy"| lazy_products
  lazy_products -->|"child"| cmp_16
  lazy_products -->|"/new · child"| cmp_18
  lazy_products -->|"/:id · child · canActivate: ProductExistsGuard"| cmp_14
  lazy_products -->|"/:id/edit · child · canActivate: AuthGuard, UnsavedChangesGuard"| cmp_15
  cmp_1 -.->|"/admin · lazy"| cmp_2
  cmp_2 -.->|"lazy"| cmp_7
  cmp_2 -.->|"/users · lazy"| cmp_9
  cmp_2 -.->|"/users/:id · lazy · canActivate: SuperAdminGuard"| cmp_8
  cmp_1 -->|"/profile · canActivate: AuthGuard, RoleGuard"| cmp_5
  cmp_1 -->|"/settings"| cmp_6
  cmp_1 -.->|"/catalog · lazy"| lazy_catalog
  lazy_catalog -->|"child"| cmp_12
  lazy_catalog -->|"/item/:slug · child · canActivate: FeatureFlagGuard"| cmp_13
  lazy_catalog -->|"/compare · child"| cmp_11
  cmp_1 -->|"/**"| cmp_4
  cmp_3 --o guard_1
  cmp_14 --o guard_3
  cmp_15 --o guard_1
  cmp_15 --o guard_6
  cmp_8 --o guard_5
  cmp_5 --o guard_1
  cmp_5 --o guard_4
  cmp_13 --o guard_2
  cmp_3 --o cmp_19
  cmp_3 --o cmp_17
  cmp_5 --o cmp_19
  cmp_9 --o cmp_20
  cmp_12 --o cmp_10
  cmp_16 --o cmp_17
  cmp_1 ==>|"/dashboard"| cmp_3
  cmp_1 ==>|"/products"| lazy_products
  cmp_1 ==>|"/catalog"| lazy_catalog
  cmp_1 ==>|"/admin/users"| cmp_9
  cmp_1 ==>|"/profile"| cmp_5
  cmp_1 ==>|"/settings"| cmp_6
  cmp_4 ==>|"/dashboard"| cmp_3
  cmp_14 ==>|"/products"| lazy_products
  cmp_15 ==>|"/products"| lazy_products
  cmp_18 ==>|"/products"| lazy_products
  cmp_1 --o svc_1
  cmp_1 --o svc_4
  cmp_2 --o svc_1
  cmp_3 --o svc_5
  cmp_3 --o svc_7
  cmp_5 --o svc_7
  cmp_5 --o svc_1
  cmp_6 --o svc_1
  cmp_7 --o svc_7
  cmp_7 --o svc_5
  cmp_8 --o svc_7
  cmp_8 --o svc_4
  cmp_9 --o svc_7
  cmp_11 --o svc_2
  cmp_12 --o svc_2
  cmp_13 --o svc_2
  cmp_14 --o svc_5
  cmp_14 --o svc_4
  cmp_15 --o svc_5
  cmp_15 --o svc_4
  cmp_16 --o svc_5
  cmp_18 --o svc_5
  cmp_18 --o svc_4
  svc_5 --o svc_4
  svc_6 --o svc_1
  svc_7 --o svc_4
  cmp_1 --o dir_2
  cmp_3 --o dir_1
  cmp_13 --o dir_1
  cmp_17 --o dir_1
  cmp_20 --o dir_1
  cmp_3 --o pipe_2
  cmp_3 --o pipe_1
  cmp_9 --o pipe_2
  cmp_10 --o pipe_2
  cmp_11 --o pipe_1
  cmp_12 --o pipe_2
  cmp_13 --o pipe_1
  cmp_14 --o pipe_1
  cmp_16 --o pipe_2

  class cmp_1 rootStyle
  class cmp_2,cmp_3,cmp_4,cmp_5,cmp_6,cmp_7,cmp_8,cmp_9,cmp_10,cmp_11,cmp_12,cmp_13,cmp_14,cmp_15,cmp_16,cmp_17,cmp_18,cmp_19,cmp_20 componentStyle
  class svc_1,svc_2,svc_3,svc_4,svc_5,svc_6,svc_7 serviceStyle
  class dir_1,dir_2 directiveStyle
  class pipe_1,pipe_2 pipeStyle
  class guard_1,guard_2,guard_3,guard_4,guard_5,guard_6 guardStyle
  class lazy_products,lazy_catalog moduleStyle